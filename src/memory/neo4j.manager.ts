import neo4j, { Driver } from 'neo4j-driver';
import {
  AdvancedSearchQuery,
  Entity,
  IKnowledgeGraphManager,
  KnowledgeGraph,
  Relation,
} from './types.js';

// Lazily initialize the embedding pipeline to avoid issues in test environments.
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

// Exported for testing purposes
export async function getEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

interface UpdateVector {
    name: string;
    observations: string[];
    vector: number[];
}

export class Neo4jKnowledgeGraphManager implements IKnowledgeGraphManager {
  private driver: Driver;
  private connected = false;

  constructor() {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      throw new Error(
        'Neo4j environment variables (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD) must be set'
      );
    }

    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    // Asynchronously initialize and don't block constructor
    this.init();
  }

  private async init(): Promise<void> {
      try {
          await this.driver.verifyConnectivity();
          await this.initSchema();
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
      // Idempotently create constraint
      const constraintResult = await session.run("SHOW CONSTRAINTS YIELD name WHERE name = 'entity_name_unique' RETURN name");
      if (constraintResult.records.length === 0) {
        await session.run('CREATE CONSTRAINT entity_name_unique FOR (e:Entity) REQUIRE e.name IS UNIQUE');
        console.log("Created constraint: entity_name_unique");
      }

      // Idempotently create vector index
      const indexResult = await session.run("SHOW VECTOR INDEXES YIELD name WHERE name = 'entity_observations' RETURN name");
      if (indexResult.records.length === 0) {
        const query = 'CREATE VECTOR INDEX entity_observations FOR (e:Entity) ON (e.observationVector) ' +
                      "OPTIONS { indexConfig: { " +
                      " `vector.dimensions`: 384, " +
                      " `vector.similarity_function`: 'cosine' " +
                      "} }";
        await session.run(query);
        console.log("Created vector index: entity_observations");
      }
    } finally {
      await session.close();
    }
  }

  private checkConnection(): void {
      if (!this.connected) {
          throw new Error("Neo4j manager is not connected to the database. Please check logs for connection errors.");
      }
  }

  async verifyConnectivity(): Promise<{ok: boolean, error?: string}> {
      if (this.connected) {
          return { ok: true };
      }
      // Try to re-establish connection if not connected
      await this.init();
      if(this.connected) {
          return { ok: true };
      }
      return { ok: false, error: "Failed to connect to Neo4j. See server logs for details." };
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    this.checkConnection();

    const entitiesWithVectors = await Promise.all(entities.map(async (entity) => {
        let vector: number[] = [];
        if (entity.observations && entity.observations.length > 0) {
            vector = await getEmbedding(entity.observations.join('; '));
        }
        return {
            ...entity,
            vector: vector
        };
    }));

    const session = this.driver.session();
    try {
      const result = await session.executeWrite(async (tx) => {
        const query = `
          UNWIND $entities AS entityData
          MERGE (e:Entity {name: entityData.name})
          ON CREATE SET
            e.entityType = entityData.entityType,
            e.observations = entityData.observations,
            e.observationVector = entityData.vector
          RETURN e
        `;
        const response = await tx.run(query, { entities: entitiesWithVectors });
        return response.records.map(record => {
            const { vector, ...properties } = record.get('e').properties;
            return properties as Entity;
        });
      });
      return result;
    } finally {
      await session.close();
    }
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      const result = await session.executeWrite(async (tx) => {
        const query = `
          UNWIND $relations AS rel
          MATCH (from:Entity {name: rel.from})
          MATCH (to:Entity {name: rel.to})
          MERGE (from)-[r:RELATION {type: rel.relationType}]->(to)
          RETURN rel
        `;
        const response = await tx.run(query, { relations });
        return response.records.map(record => record.get('rel') as Relation);
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
        const existingEntities = await session.executeRead(async tx => {
            const result = await tx.run(
                'UNWIND $names AS name MATCH (e:Entity {name: name}) RETURN e.name AS name, e.observations AS observations',
                { names: entityNames }
            );
            return new Map(result.records.map(r => [r.get('name'), r.get('observations')]));
        });

        const updates: UpdateVector[] = [];
        const results: { entityName: string; addedObservations: string[]; }[] = [];

        for (const obs of observations) {
            const existingObs = existingEntities.get(obs.entityName);
            if (existingObs === undefined) {
                results.push({ entityName: obs.entityName, addedObservations: [] });
                continue;
            }
            const newObservations = obs.contents.filter(c => !existingObs.includes(c));
            if (newObservations.length > 0) {
                const allObservations = [...existingObs, ...newObservations];
                const vector = await getEmbedding(allObservations.join('; '));
                updates.push({
                    name: obs.entityName,
                    observations: allObservations,
                    vector: vector,
                });
            }
            results.push({ entityName: obs.entityName, addedObservations: newObservations });
        }

        if (updates.length > 0) {
            await session.executeWrite(async tx => {
                await tx.run(
                    `UNWIND $updates AS update
                     MATCH (e:Entity {name: update.name})
                     SET e.observations = update.observations, e.observationVector = update.vector`,
                    { updates }
                );
            });
        }
        return results;
    } finally {
        await session.close();
    }
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run('MATCH (e:Entity) WHERE e.name IN $names DETACH DELETE e', { names: entityNames });
      });
    } finally {
      await session.close();
    }
  }

  async deleteObservations(deletions: { entityName: string; observations: string[]; }[]): Promise<void> {
    this.checkConnection();
    const session = this.driver.session();
    try {
        const entityNames = deletions.map(d => d.entityName);
        const existingEntities = await session.executeRead(async tx => {
            const result = await tx.run(
                'UNWIND $names AS name MATCH (e:Entity {name: name}) RETURN e.name AS name, e.observations AS observations',
                { names: entityNames }
            );
            return new Map(result.records.map(r => [r.get('name'), r.get('observations')]));
        });

        const updates: UpdateVector[] = [];
        for (const del of deletions) {
            const existingObs = existingEntities.get(del.entityName);
            if (!existingObs) continue;

            const toDeleteSet = new Set(del.observations);
            const newObs = existingObs.filter((o: string) => !toDeleteSet.has(o));

            if (newObs.length < existingObs.length) {
                 const vector = newObs.length > 0 ? await getEmbedding(newObs.join('; ')) : [];
                 updates.push({
                     name: del.entityName,
                     observations: newObs,
                     vector: vector,
                 });
            }
        }

        if (updates.length > 0) {
            await session.executeWrite(async tx => {
                await tx.run(
                    `UNWIND $updates AS update
                     MATCH (e:Entity {name: update.name})
                     SET e.observations = update.observations, e.observationVector = update.vector`,
                    { updates }
                );
            });
        }
    } finally {
        await session.close();
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(`
          UNWIND $relations AS rel
          MATCH (from:Entity {name: rel.from})-[r:RELATION {type: rel.relationType}]->(to:Entity {name: rel.to})
          DELETE r
        `, { relations });
      });
    } finally {
      await session.close();
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      const result = await session.executeRead(async (tx) => {
        const response = await tx.run(`
          MATCH (e:Entity)
          OPTIONAL MATCH (e)-[r:RELATION]->(e2:Entity)
          RETURN e, collect({to: e2.name, from: e.name, relationType: r.type}) AS relations
        `);
        const entities: Entity[] = [];
        const relations: Relation[] = [];
        const seenEntities = new Set<string>();

        for (const record of response.records) {
          const entityNode = record.get('e').properties;
          if (!seenEntities.has(entityNode.name)) {
            entities.push(entityNode as Entity);
            seenEntities.add(entityNode.name);
          }
          const rels = record.get('relations');
          for (const rel of rels) {
            if (rel.to && rel.from && rel.relationType) {
              relations.push(rel);
            }
          }
        }
        return { entities, relations };
      });
      return result;
    } finally {
      await session.close();
    }
  }

  async searchNodes(query: AdvancedSearchQuery): Promise<KnowledgeGraph> {
    this.checkConnection();
    switch (query.type) {
      case 'keyword':
        return this.readGraph().then(graph => {
            const q = query.query.toLowerCase();
            const filteredEntities = graph.entities.filter(e =>
                e.name.toLowerCase().includes(q) ||
                e.entityType.toLowerCase().includes(q) ||
                e.observations.some((o: string) => o.toLowerCase().includes(q))
            );
            const names = new Set(filteredEntities.map(e => e.name));
            const filteredRelations = graph.relations.filter(r => names.has(r.from) && names.has(r.to));
            return { entities: filteredEntities, relations: filteredRelations };
        });
      case 'cypher':
        return this.executeCypher(query.query);
      case 'semantic':
        return this.semanticSearch(query.text, query.topK);
      case 'traversal':
          return this.traversalSearch(query.startNode, query.hops, query.endLabel);
      case 'hybrid':
        // Not implemented, return empty graph
        return Promise.resolve({ entities: [], relations: [] });
      default:
        throw new Error('Unknown search type');
    }
  }

  private async executeCypher(query: string): Promise<KnowledgeGraph> {
      this.checkConnection();
      const session = this.driver.session();
      try {
          const result = await session.executeRead(async tx => {
              const res = await tx.run(query);
              const entities: Entity[] = [];
              const relations: Relation[] = [];
              const entityNames = new Set<string>();

              res.records.forEach(record => {
                  if (record.has('e')) {
                      const entity = record.get('e').properties as Entity;
                      if (!entityNames.has(entity.name)) {
                          entities.push(entity);
                          entityNames.add(entity.name);
                      }
                  }
                  if (record.has('r')) {
                      // This part requires a more robust mapping logic.
                  }
              });
              return { entities, relations };
          });
          return result;
      } finally {
          await session.close();
      }
  }

  private async semanticSearch(text: string, topK: number = 5): Promise<KnowledgeGraph> {
      this.checkConnection();
      const vector = await getEmbedding(text);
      const session = this.driver.session();
      try {
          const result = await session.executeRead(async tx => {
              const res = await tx.run(
                  `CALL db.index.vector.queryNodes('entity_observations', $topK, $vector) YIELD node, score
                   RETURN node.name AS name`,
                  { topK, vector }
              );
              const names = res.records.map(r => r.get('name'));
              return this.openNodes(names);
          });
          return result;
      } finally {
          await session.close();
      }
  }

  private async traversalSearch(startNode: string, hops: {type: string, direction: 'in' | 'out'}[], endLabel?: string): Promise<KnowledgeGraph> {
    this.checkConnection();
    const session = this.driver.session();
    try {
        let pattern = '';
        hops.forEach((hop, index) => {
            if (!/^[A-Z_]+$/i.test(hop.type)) {
                throw new Error(`Invalid relationship type in traversal: ${hop.type}`);
            }
            if (hop.direction === 'out') {
                pattern += `-[r${index}:${hop.type}]->(n${index})`;
            } else {
                pattern += `<-[r${index}:${hop.type}]-(n${index})`;
            }
        });

        const endNodeMatch = `(end:Entity${endLabel ? ':' + endLabel : ''})`;
        pattern = pattern.replace(/n\d+$/, endNodeMatch);

        const query = `MATCH (start:Entity {name: $startNode})${pattern} RETURN end.name AS name`;

        const result = await session.executeRead(async tx => {
            const res = await tx.run(query, { startNode });
            const names = res.records.map(r => r.get('name'));
            if (names.length === 0) {
                return { entities: [], relations: [] };
            }
            return this.openNodes([startNode, ...names]);
        });
        return result;
    } finally {
        await session.close();
    }
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    this.checkConnection();
    const session = this.driver.session();
    try {
      const result = await session.executeRead(async (tx) => {
        const response = await tx.run(`
          MATCH (e:Entity) WHERE e.name IN $names
          OPTIONAL MATCH (e)-[r:RELATION]-(e2:Entity) WHERE e2.name IN $names
          RETURN e, collect({from: startNode(r).name, to: endNode(r).name, relationType: r.type}) as relations
        `, { names });

        const entities: Entity[] = [];
        const relations: Relation[] = [];
        const entityNames = new Set<string>();
        const relKeys = new Set<string>();

        for (const record of response.records) {
          const entityNode = record.get('e').properties;
          if (!entityNames.has(entityNode.name)) {
            entities.push(entityNode as Entity);
            entityNames.add(entityNode.name);
          }
          const rels: Relation[] = record.get('relations');
          for (const rel of rels) {
            const key = `${rel.from}-${rel.relationType}->${rel.to}`;
            if (rel.from && rel.to && rel.relationType && !relKeys.has(key)) {
              relations.push(rel);
              relKeys.add(key);
            }
          }
        }
        return { entities, relations };
      });
      return result;
    } finally {
      await session.close();
    }
  }

  async shutdown(): Promise<void> {
    await this.driver.close();
  }
}
