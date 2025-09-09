import { IRetriever } from './search.types.js';
import neo4j, { Driver } from 'neo4j-driver';

/**
 * A retriever that fetches data from a Neo4j knowledge graph.
 */
export class GraphRetriever implements IRetriever {
  public readonly name = 'graph';
  private driver: Driver;

  /**
   * Creates a new GraphRetriever.
   * @param driver A Neo4j driver instance.
   */
  constructor(driver: Driver) {
    this.driver = driver;
  }

  /**
   * Retrieves nodes from the graph that are related to the query.
   * For this basic implementation, we assume the query is an entity name
   * and find its neighbors.
   * @param query The search query, treated as an entity name.
   * @returns A promise that resolves to an array of search results.
   */
  public async retrieve(
    query: string
  ): Promise<{ id: string; content: string; score: number }[]> {
    const session = this.driver.session();
    try {
      // This query finds a starting node by its name and then returns the node
      // itself plus all of its immediate neighbors (1-hop away).
      const result = await session.run(
        `
        MATCH (n) WHERE n.name =~ $name
        OPTIONAL MATCH (n)-[r]-(neighbor)
        RETURN n, neighbor
        `,
        { name: `(?i)${query}` } // Case-insensitive regex match
      );

      const foundNodes = new Map<string, { id: string; content: string }>();

      result.records.forEach((record) => {
        const startNode = record.get('n');
        const neighborNode = record.get('neighbor');

        if (startNode && startNode.properties) {
          const { name, observations } = startNode.properties;
          if (name && !foundNodes.has(name)) {
            foundNodes.set(name, {
              id: name,
              content: `Entity: ${name}. Observations: ${(observations || []).join(
                ', '
              )}`,
            });
          }
        }

        if (neighborNode && neighborNode.properties) {
          const { name, observations } = neighborNode.properties;
          if (name && !foundNodes.has(name)) {
            foundNodes.set(name, {
              id: name,
              content: `Entity: ${name}. Observations: ${(observations || []).join(
                ', '
              )}`,
            });
          }
        }
      });

      // Assign a constant score to all results from the graph.
      // The fusion algorithm (RRF) is rank-based, so the absolute score
      // is less important than the fact that it was retrieved.
      return Array.from(foundNodes.values()).map((node) => ({
        ...node,
        score: 1.0,
      }));
    } finally {
      await session.close();
    }
  }
}
