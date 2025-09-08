// Prerequisite Type Definitions (from original implementation)
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The core interface contract for all memory backends.
export interface IKnowledgeGraphManager {
  createEntities(entities: Entity[]): Promise<Entity[]>;

  createRelations(relations: Relation[]): Promise<Relation[]>;

  addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName:string; addedObservations: string[] }[]>;

  deleteEntities(entityNames: string[]): Promise<void>;

  deleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void>;

  deleteRelations(relations: Relation[]): Promise<void>;

  readGraph(): Promise<KnowledgeGraph>;

  // The search/open methods will be enhanced to support advanced queries.
  // The input type will be a discriminated union to specify the query type.
  searchNodes(query: AdvancedSearchQuery): Promise<KnowledgeGraph>;

  openNodes(names: string[]): Promise<KnowledgeGraph>;

  // Added for resource management in Neo4j
  shutdown?(): Promise<void>;

  // Added for health checks
  verifyConnectivity(): Promise<{ok: boolean, error?: string}>;
}

// Type definition for the enhanced search functionality
interface TraversalHop {
    type: string;
    direction: 'in' | 'out';
}

export type AdvancedSearchQuery =
  | { type: 'keyword'; query: string }
  | { type: 'cypher'; query: string }
  | { type: 'semantic'; text: string; topK?: number }
  | { type: 'traversal'; startNode: string; hops: TraversalHop[]; endLabel?: string; }
  | { type: 'hybrid'; queries: Exclude<AdvancedSearchQuery, { type: 'hybrid' }>[] };
