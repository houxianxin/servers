// --- V1 Data Structures (for reference and backward compatibility) ---
export interface EntityV1 {
  name: string;
  entityType: string;
  observations: string[];
}

export interface RelationV1 {
  from: string;
  to: string;
  relationType: string;
}

// --- V2 Data Structures (Holographic & Extensible) ---

/**
 * ObservationV2: A structured, first-class citizen object for observations.
 */
export interface ObservationV2 {
  id: string;          // Unique ID
  content: string;     // The core text content
  source: string;      // Provenance (e.g., "user:123", "doc:abc.pdf")
  timestamp: number;   // Creation Unix timestamp (ms)
  confidence?: number; // Confidence score (0.0 to 1.0)
  vector?: number[];   // Vector embedding of the content
}

/**
 * RelationV2: A relation with its own properties and metadata.
 */
export interface RelationV2 {
  from: string;
  to: string;
  relationType: string;
  properties?: Record<string, any>; // Properties of the relation itself

  // Metadata
  createdAt?: number;
  source?: string;
  confidence?: number;
}

/**
 * EntityV2: The new holographic entity interface.
 */
export interface EntityV2 {
  name: string;
  tags: string[];
  observations: ObservationV2[];
  createdAt: number;
  updatedAt: number;
}

// --- Union Types & Type Guards ---

export type AnyEntity = EntityV1 | EntityV2;
export type AnyRelation = RelationV1 | RelationV2;

/**
 * Type guard to check if an entity is in the V2 format.
 * @param entity The entity to check.
 * @returns True if the entity is an EntityV2, false otherwise.
 */
export function isV2Entity(entity: any): entity is EntityV2 {
  // The most reliable check is the structure of the 'observations' array.
  // If it's empty, we check for V2-specific fields like 'tags' or 'createdAt'.
  if (!entity.observations || entity.observations.length === 0) {
    return 'tags' in entity && 'createdAt' in entity;
  }
  return typeof entity.observations[0] === 'object' && entity.observations[0] !== null;
}

import { SearchResultItem } from './search.types.js';

// --- Core Interfaces ---

/**
 * The KnowledgeGraph snapshot now holds V2 structures.
 */
export interface KnowledgeGraph {
  entities: EntityV2[];
  relations: RelationV2[];
}

// The manager interface remains largely the same externally,
// but internally it will now work with and produce V2 data.
export interface IKnowledgeGraphManager {
  // Input signature remains V1-like for compatibility
  createEntities(entities: { name: string; entityType: string; observations: string[] }[]): Promise<EntityV2[]>;

  createRelations(relations: RelationV1[]): Promise<RelationV2[]>;

  addObservations(
    observations: { entityName: string; contents: string[]; }[]
  ): Promise<{ entityName:string; addedObservations: string[] }[]>;

  deleteEntities(entityNames: string[]): Promise<void>;

  deleteObservations(
    deletions: { entityName: string; observations: string[] }[]
  ): Promise<void>;

  deleteRelations(relations: RelationV1[]): Promise<void>;

  readGraph(): Promise<KnowledgeGraph>;

  searchNodes(query: AdvancedSearchQuery): Promise<KnowledgeGraph>;

  hybridSearch(query: string): Promise<SearchResultItem[]>;

  openNodes(names: string[]): Promise<KnowledgeGraph>;

  shutdown?(): Promise<void>;

  verifyConnectivity(): Promise<{ok: boolean, error?: string}>;
}

// --- Search Query Types (Updated for V2) ---

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
