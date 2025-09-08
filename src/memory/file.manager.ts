import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AdvancedSearchQuery,
  Entity,
  IKnowledgeGraphManager,
  KnowledgeGraph,
  Relation,
} from './types.js';

export class FileKnowledgeGraphManager implements IKnowledgeGraphManager {
  private getMemoryFilePath(): string {
    const memoryFile = process.env.MEMORY_FILE_PATH || 'memory.json';
    if (path.isAbsolute(memoryFile)) {
      return memoryFile;
    }
    // This is tricky in ESM, as import.meta.url is the only reliable way to get current file path.
    // We assume the script is run from a location where relative paths make sense,
    // or that an absolute path is provided for MEMORY_FILE_PATH.
    // For testing, setting an absolute path via process.env is the most reliable.
    // A simplified path for bundled applications.
    return path.join(process.cwd(), memoryFile);
  }

  private async loadGraph(): Promise<KnowledgeGraph> {
    const filePath = this.getMemoryFilePath();
    try {
      const data = await fs.readFile(filePath, "utf-8");
      // A simple JSONL format where each line is a typed object
      const lines = data.split("\n").filter(line => line.trim() !== "");
      const graph: KnowledgeGraph = { entities: [], relations: [] };
      for (const line of lines) {
        const item = JSON.parse(line);
        // We are ignoring the 'type' property after parsing
        const { type, ...value } = item;
        if (type === "entity") {
          graph.entities.push(value as Entity);
        } else if (type === "relation") {
          graph.relations.push(value as Relation);
        }
      }
      return graph;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        // If the file doesn't exist, start with an empty graph
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    const filePath = this.getMemoryFilePath();
    const lines = [
      ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })),
      ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    await fs.writeFile(filePath, lines.join("\n"));
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const graph = await this.loadGraph();
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
    if (newEntities.length > 0) {
      graph.entities.push(...newEntities);
      await this.saveGraph(graph);
    }
    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation =>
      existingRelation.from === r.from &&
      existingRelation.to === r.to &&
      existingRelation.relationType === r.relationType
    ));
    if (newRelations.length > 0) {
      graph.relations.push(...newRelations);
      await this.saveGraph(graph);
    }
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const results = observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    const originalEntityCount = graph.entities.length;
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    if (graph.entities.length < originalEntityCount) {
        await this.saveGraph(graph);
    }
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph();
    const originalRelationCount = graph.relations.length;
    graph.relations = graph.relations.filter(r => !relations.some(delRelation =>
      r.from === delRelation.from &&
      r.to === delRelation.to &&
      r.relationType === delRelation.relationType
    ));
    if(graph.relations.length < originalRelationCount) {
        await this.saveGraph(graph);
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  async searchNodes(searchQuery: AdvancedSearchQuery): Promise<KnowledgeGraph> {
    if (searchQuery.type !== 'keyword') {
      throw new Error(`File-based backend only supports 'keyword' search, but got '${searchQuery.type}'.`);
    }
    const { query } = searchQuery;
    const graph = await this.loadGraph();

    const filteredEntities = graph.entities.filter(e =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.entityType.toLowerCase().includes(query.toLowerCase()) ||
      e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
    );

    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    return {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();

    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    return {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  }

  async shutdown(): Promise<void> {
    // No-op for file-based manager
    return Promise.resolve();
  }

  async verifyConnectivity(): Promise<{ok: boolean, error?: string}> {
      // The file manager is always "connected" as long as it has permissions.
      // A more thorough check could test for write permissions in the directory.
      return Promise.resolve({ ok: true });
  }
}
