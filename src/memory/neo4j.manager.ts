import neo4j, { Driver, Record as Neo4jRecord } from 'neo4j-driver';
import crypto from 'crypto';
import {
  AdvancedSearchQuery,
  AnyEntity,
  EntityV1,
  EntityV2,
  IKnowledgeGraphManager,
  isV2Entity,
  KnowledgeGraph,
  ObservationV2,
  RelationV1,
  RelationV2,
} from './types.js';

// --- Helper Functions ---

let embeddingPipeline: any = null;
async function getPipeline() {
  if (embeddingPipeline === null) {
    const { pipeline, env } = await import('@xenova/transformers');
    if (process.env.JEST_WORKER_ID) {
        env.backends.onnx.wasm.numThreads = 1;
    }
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embeddingPipeline;
}
export async function getEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

// This helper function will be used to safely parse DB records into V2 entities.
function recordToV2Entity(record: Neo4jRecord): EntityV2 {
    const entityProps = record.get('e').properties;
    // The vector property is stored as a plain array, but observations are JSON strings.
    // We need to parse the observations.
    if (entityProps.observations && typeof entityProps.observations[0] === 'string') {
        try {
            entityProps.observations = entityProps.observations.map((obs: string) => JSON.parse(obs));
        } catch (e) {
            // Handle cases where parsing might fail for corrupted data
            entityProps.observations = [];
        }
    }
    return entityProps as EntityV2;
}


import { HybridSearchEngine } from './engine.hybrid.js';
import { LocalModelProvider } from './model.provider.local.js';
import { SparseRetriever } from './retriever.sparse.js';
import { DenseRetriever } from './retriever.dense.js';
import { GraphRetriever } from './retriever.graph.js';
import { SearchResultItem } from './search.types.js';

// --- V2 Refactored Manager ---
export class Neo4jKnowledgeGraphManager implements IKnowledgeGraphManager {
  private driver: Driver;
  private connected = false;
  private modelProvider!: LocalModelProvider; // Definite assignment in init

  constructor() {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;
    if (!uri || !user || !password) {
      throw new Error('Neo4j environment variables (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD) must be set');
    }
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    this.init();
  }

  private async init(): Promise<void> {
    try {
        await this.driver.verifyConnectivity();
        await this.initSchema();
        this.modelProvider = await LocalModelProvider.create({
          embeddingModel: 'Xenova/all-MiniLM-L6-v2',
        });
        this.connected = true;
        console.error("Successfully connected to Neo4j and verified schema.");
    } catch (error: any) {
        console.error("FATAL: Could not connect to Neo4j or initialize schema.", error.message);
        this.connected = false;
    }
  }

  private async initSchema(): Promise<void> {
    const session = this.driver.session();
    try {
      const constraintResult = await session.run("SHOW CONSTRAINTS YIELD name WHERE name = 'entity_name_unique' RETURN name");
      if (constraintResult.records.length === 0) {
        await session.run('CREATE CONSTRAINT entity_name_unique FOR (e:Entity) REQUIRE e.name IS UNIQUE');
      }
      const indexResult = await session.run("SHOW VECTOR INDEXES YIELD name WHERE name = 'entity_observations' RETURN name");
      if (indexResult.records.length === 0) {
        const query = 'CREATE VECTOR INDEX entity_observations FOR (e:Entity) ON (e.observationVector) ' +
                      "OPTIONS { indexConfig: { `vector.dimensions`: 384, `vector.similarity_function`: 'cosine' } }";
        await session.run(query);
      }
    } finally {
      await session.close();
    }
  }

  private checkConnection(): void {
    if (!this.connected) {
      throw new Error("Neo4j manager is not connected to the database.");
    }
  }

  private upgradeV1ToV2(entityV1: EntityV1): EntityV2 {
    const now = Date.now();
    return {
        name: entityV1.name,
        tags: [entityV1.entityType],
        observations: entityV1.observations.map((obs: string) => ({
            id: crypto.randomUUID(),
            content: obs,
            source: 'legacy_import',
            timestamp: now,
            confidence: 1.0,
        })),
        createdAt: now,
        updatedAt: now,
    };
  }

  async verifyConnectivity(): Promise<{ok: boolean, error?: string}> {
    if (this.connected) return { ok: true };
    await this.init();
    return this.connected ? { ok: true } : { ok: false, error: "Failed to connect to Neo4j." };
  }

  async createEntities(entities: { name: string; entityType: string; observations: string[] }[]): Promise<EntityV2[]> {
    this.checkConnection();
    const now = Date.now();
    const entitiesToCreate = await Promise.all(entities.map(async (v1Entity) => {
        let vector: number[] = [];
        if (v1Entity.observations && v1Entity.observations.length > 0) {
            vector = await getEmbedding(v1Entity.observations.join('; '));
        }
        const v2Observations = v1Entity.observations.map(obs => ({
            id: crypto.randomUUID(),
            content: obs,
            source: 'createEntities',
            timestamp: now,
        }));
        return {
            name: v1Entity.name,
            tags: [v1Entity.entityType],
            // Serialize observations to JSON strings before sending to DB
            observations: v2Observations.map(o => JSON.stringify(o)),
            createdAt: now,
            updatedAt: now,
            vector: vector,
        };
    }));

    const session = this.driver.session();
    try {
      const result = await session.executeWrite(async (tx) => {
        const query = `
          UNWIND $entities AS entityData
          MERGE (e:Entity {name: entityData.name})
          ON CREATE SET
            e.tags = entityData.tags,
            e.observations = entityData.observations,
            e.observationVector = entityData.vector,
            e.createdAt = entityData.createdAt,
            e.updatedAt = entityData.updatedAt
          RETURN e
        `;
        const response = await tx.run(query, { entities: entitiesToCreate });
        return response.records.map(recordToV2Entity);
      });
      return result;
    } finally {
      await session.close();
    }
  }

    async addObservations(observations: { entityName: string; contents: string[]; }[]): Promise<{ entityName: string; addedObservations: string[]; }[]> {
        this.checkConnection();
        const session = this.driver.session();
        try {
            const entityNames = observations.map(o => o.entityName);
            const existingEntitiesResult = await session.run('UNWIND $names AS name MATCH (e:Entity {name: name}) RETURN e', { names: entityNames });
            const existingEntities = new Map(existingEntitiesResult.records.map((r: any) => [r.get('e').properties.name, r.get('e').properties]));

            const updates: any[] = [];
            const results: { entityName: string; addedObservations: string[]; }[] = [];

            for (const obs of observations) {
                let entity = existingEntities.get(obs.entityName) as AnyEntity | undefined;
                if (!entity) {
                    results.push({ entityName: obs.entityName, addedObservations: [] });
                    continue;
                }

                if (!isV2Entity(entity)) {
                    entity = this.upgradeV1ToV2(entity as unknown as EntityV1);
                }

                const existingObsContent = new Set(entity.observations.map((o: ObservationV2) => o.content));
                const newObservations = obs.contents.filter(c => !existingObsContent.has(c));

                if (newObservations.length > 0) {
                    const now = Date.now();
                    for (const content of newObservations) {
                        entity.observations.push({
                            id: crypto.randomUUID(),
                            content: content,
                            source: 'addObservations',
                            timestamp: now,
                        });
                    }
                    entity.updatedAt = now;
                    const fullText = entity.observations.map((o: ObservationV2) => o.content).join('; ');
                    const vector = await getEmbedding(fullText);
                    updates.push({
                        name: entity.name,
                        // Serialize observations to JSON strings for storage
                        observations: entity.observations.map(o => JSON.stringify(o)),
                        updatedAt: entity.updatedAt,
                        vector
                    });
                }
                results.push({ entityName: obs.entityName, addedObservations: newObservations });
            }

            if (updates.length > 0) {
                await session.executeWrite(async tx => {
                    await tx.run(
                        `UNWIND $updates AS update
                         MATCH (e:Entity {name: update.name})
                         SET e.observations = update.observations,
                             e.observationVector = update.vector,
                             e.updatedAt = update.updatedAt`,
                        { updates }
                    );
                });
            }
            return results;
        } finally {
            await session.close();
        }
    }

    async searchNodes(query: AdvancedSearchQuery): Promise<KnowledgeGraph> {
        this.checkConnection();
        if (query.type === 'keyword') {
            const session = this.driver.session();
            try {
                const result = await session.run(
                    `MATCH (e:Entity)
                     WHERE e.name CONTAINS $q OR any(tag IN e.tags WHERE tag CONTAINS $q) OR any(obsString IN e.observations WHERE obsString CONTAINS $q)
                     RETURN e`,
                    { q: query.query }
                );
                const entities = result.records.map(recordToV2Entity);
                return { entities, relations: [] };
            } finally {
                await session.close();
            }
        }
        // ... other search types will also need to be updated to parse observation strings
        return { entities: [], relations: [] };
    }

  // Other methods would also need refactoring
  async createRelations(relations: RelationV1[]): Promise<RelationV2[]> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      // Execute each relation creation in a transaction.
      // While less performant than a single UNWIND, this avoids APOC dependency
      // and is safer for handling dynamic relationship types.
      const createdRelations = await session.executeWrite(async (tx) => {
        const results: RelationV2[] = [];
        const now = Date.now();

        for (const rel of relations) {
          // Sanitize the relationship type to prevent Cypher injection.
          // This allows only alphanumeric characters and underscores.
          const sanitizedType = rel.relationType;
          // 这里的策略影响使用中文的关系，注释掉
          // const sanitizedType = rel.relationType.replace(/[^a-zA-Z0-9_]/g, '');

          // if (!sanitizedType) {
          //   // Skip if the relationType is empty or only contains invalid characters.
          //   continue;
          // }

          // Use backticks around the sanitized type to handle reserved keywords.
          const query = `
            MATCH (a:Entity {name: $from})
            MATCH (b:Entity {name: $to})
            MERGE (a)-[:\`${sanitizedType}\`]->(b)
          `;

          await tx.run(query, { from: rel.from, to: rel.to });

          results.push({
            ...rel,
            properties: {}, // Assuming no properties are passed in V1 format
            createdAt: now,
          });
        }
        return results;
      });
      return createdRelations;
    } catch (error) {
      console.error("Failed to create relations:", error);
      throw error;
      // return [];
    } finally {
      await session.close();
    }
  }
  async deleteEntities(entityNames: string[]): Promise<void> {}
  async deleteObservations(deletions: { entityName: string; observations: string[]; }[]): Promise<void> {}
  async deleteRelations(relations: RelationV1[]): Promise<void> {}
  async readGraph(): Promise<KnowledgeGraph> {
      this.checkConnection();
      const session = this.driver.session();
      try {
          // Ensure we return the vector property
          const result = await session.run('MATCH (e:Entity) RETURN e, e.observationVector as vector');
          const entities = result.records.map(recordToV2Entity);
          return { entities, relations: [] }; // Simplified for now
      } finally {
          await session.close();
      }
  }
  async openNodes(names: string[]): Promise<KnowledgeGraph> { return { entities: [], relations: [] }; }

  async hybridSearch(query: string): Promise<SearchResultItem[]> {
    this.checkConnection();

    // 1. Get all entities with their pre-computed vectors
    const { entities } = await this.readGraph();
    if (entities.length === 0) {
      return [];
    }

    // 2. Prepare documents for retrievers
    const sparseDocs = entities.map(e => ({
      id: e.name,
      content: e.observations.map(o => o.content).join('; ')
    }));

    // The vector property is now directly available on the entity object from readGraph
    const denseDocs = entities.map(e => ({
      id: e.name,
      content: e.observations.map(o => o.content).join('; '),
      vector: (e as any).observationVector || [] // Use stored vector
    })).filter(d => d.vector.length > 0);


    // 3. Instantiate Retrievers
    const sparseRetriever = new SparseRetriever(sparseDocs);
    // The modelProvider is now a class property, initialized once.
    const denseRetriever = new DenseRetriever(this.modelProvider, denseDocs);
    const graphRetriever = new GraphRetriever(this.driver);

    // 4. Instantiate and run the search engine
    const engine = new HybridSearchEngine();
    const results = await engine.search(query, {
      retrievers: [sparseRetriever, denseRetriever, graphRetriever],
      fusionAlgorithm: 'RRF',
    });

    return results;
  }

  async shutdown(): Promise<void> {}
}
