import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AnyEntity,
  EntityV2,
  IKnowledgeGraphManager,
  isV2Entity,
  KnowledgeGraph,
  ObservationV2,
  RelationV1,
  RelationV2,
  AdvancedSearchQuery,
  SearchResultItem,
} from './types.js';
import { SparseRetriever } from './retriever.sparse.js';

export class FileKnowledgeGraphManager implements IKnowledgeGraphManager {
  private getMemoryFilePath(): string {
    const memoryFile = process.env.MEMORY_FILE_PATH || 'memory.json';
    return path.isAbsolute(memoryFile) ? memoryFile : path.join(process.cwd(), memoryFile);
  }

  private async loadGraph(): Promise<{ entities: Map<string, AnyEntity>, relations: RelationV2[] }> {
    const filePath = this.getMemoryFilePath();
    const entities = new Map<string, AnyEntity>();
    const relations: RelationV2[] = [];

    try {
      const data = await fs.readFile(filePath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      for (const line of lines) {
        const item = JSON.parse(line);
        const { type, ...value } = item;
        if (type === "entity") {
          entities.set(value.name, value as AnyEntity);
        } else if (type === "relation") {
          relations.push(value as RelationV2); // Assume relations are V2 for simplicity in file backend
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { entities, relations };
  }

  private async saveGraph(entities: Map<string, AnyEntity>, relations: RelationV2[]): Promise<void> {
    const filePath = this.getMemoryFilePath();
    const entityLines = Array.from(entities.values()).map(e => JSON.stringify({ type: "entity", ...e }));
    const relationLines = relations.map(r => JSON.stringify({ type: "relation", ...r }));
    const lines = [...entityLines, ...relationLines];
    await fs.writeFile(filePath, lines.join("\n"));
  }

  private upgradeV1ToV2(entityV1: any): EntityV2 {
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

  async createEntities(entities: { name: string; entityType: string; observations: string[] }[]): Promise<EntityV2[]> {
    const { entities: existingEntities, relations } = await this.loadGraph();
    const newEntities: EntityV2[] = [];

    for (const v1Entity of entities) {
      if (!existingEntities.has(v1Entity.name)) {
        const now = Date.now();
        const newV2Entity: EntityV2 = {
            name: v1Entity.name,
            tags: [v1Entity.entityType],
            observations: v1Entity.observations.map(obs => ({
                id: crypto.randomUUID(),
                content: obs,
                source: 'createEntities',
                timestamp: now,
                confidence: 1.0,
            })),
            createdAt: now,
            updatedAt: now,
        };
        existingEntities.set(newV2Entity.name, newV2Entity);
        newEntities.push(newV2Entity);
      }
    }

    if (newEntities.length > 0) {
      await this.saveGraph(existingEntities, relations);
    }
    return newEntities;
  }

  async addObservations(observations: { entityName: string; contents: string[]; }[]): Promise<{ entityName: string; addedObservations: string[]; }[]> {
    const { entities, relations } = await this.loadGraph();
    const results: { entityName: string; addedObservations: string[]; }[] = [];
    let updated = false;

    for (const obs of observations) {
        let entity = entities.get(obs.entityName);
        if (!entity) {
            results.push({ entityName: obs.entityName, addedObservations: [] });
            continue;
        }

        // Upgrade on Write
        if (!isV2Entity(entity)) {
            entity = this.upgradeV1ToV2(entity);
            updated = true;
        }

        const existingObsContent = new Set(entity.observations.map(o => o.content));
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
            updated = true;
        }
        entities.set(entity.name, entity);
        results.push({ entityName: obs.entityName, addedObservations: newObservations });
    }

    if (updated) {
        await this.saveGraph(entities, relations);
    }
    return results;
  }

  async readGraph(): Promise<KnowledgeGraph> {
    const { entities, relations } = await this.loadGraph();
    const v2Entities = Array.from(entities.values()).map(e => isV2Entity(e) ? e : this.upgradeV1ToV2(e));
    return { entities: v2Entities, relations };
  }

  // Other methods would need similar refactoring...
  // For brevity in this step, focusing on the core write paths.
  // Stubs for other methods:
  async createRelations(relations: RelationV1[]): Promise<RelationV2[]> { return []; }
  async deleteEntities(entityNames: string[]): Promise<void> {}
  async deleteObservations(deletions: { entityName: string; observations: string[]; }[]): Promise<void> {}
  async deleteRelations(relations: RelationV1[]): Promise<void> {}
  async searchNodes(query: AdvancedSearchQuery): Promise<KnowledgeGraph> { return { entities: [], relations: [] };}

  async hybridSearch(query: string): Promise<SearchResultItem[]> {
    const { entities } = await this.readGraph();
    if (entities.length === 0) {
      return [];
    }

    const sparseDocs = entities.map(e => ({
      id: e.name,
      content: e.observations.map(o => o.content).join('; ')
    }));

    const sparseRetriever = new SparseRetriever(sparseDocs);
    const sparseResults = await sparseRetriever.retrieve(query);

    // Convert retriever results to the final SearchResultItem format
    return sparseResults.map(result => ({
      id: result.id,
      content: result.content,
      score: result.score,
      retrievedBy: ['sparse'],
      originalScores: [{ retriever: 'sparse', score: result.score }],
    }));
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> { return { entities: [], relations: [] };}
  async shutdown(): Promise<void> { return Promise.resolve(); }
  async verifyConnectivity(): Promise<{ok: boolean, error?: string}> { return Promise.resolve({ ok: true }); }
}
