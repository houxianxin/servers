import {
  HybridSearchConfig,
  IRetriever,
  SearchResultItem,
} from './search.types.js';
import { FusionEngine } from './engine.fusion.js';
import { PassthroughReranker } from './reranker.js';

/**
 * The main engine for orchestrating hybrid search queries.
 */
export class HybridSearchEngine {
  /**
   * Performs a hybrid search by fanning out to multiple retrievers,
   * fusing the results, and then reranking them.
   * @param query The user's search query.
   * @param config The configuration for this specific search.
   * @returns A promise that resolves to the final list of search results.
   */
  public async search(
    query: string,
    config: HybridSearchConfig
  ): Promise<SearchResultItem[]> {
    // 1. Fan-Out: Run all retrievers in parallel.
    const retrieverPromises = config.retrievers.map((retriever) =>
      retriever.retrieve(query).then((results) => ({
        retrieverName: retriever.name,
        results,
      }))
    );
    const allRetrieverResults = await Promise.all(retrieverPromises);

    // Create a map of all unique documents to easily rehydrate results later.
    const allDocsMap = new Map<string, { id: string; content: string }>();
    allRetrieverResults.forEach(({ results }) => {
      results.forEach((doc) => {
        if (!allDocsMap.has(doc.id)) {
          allDocsMap.set(doc.id, { id: doc.id, content: doc.content });
        }
      });
    });

    // 2. Fuse: Combine the results using the specified fusion algorithm.
    const fusedScores = FusionEngine.fuse(
      allRetrieverResults.map((r) => r.results)
    );

    // 3. Hydrate: Combine fused scores with original document content and scores.
    const hydratedResults: SearchResultItem[] = fusedScores.map(
      ({ id, score }) => {
        const doc = allDocsMap.get(id);
        if (!doc) {
          // This should be impossible if logic is correct.
          throw new Error(`Document with id ${id} not found after fusion.`);
        }

        const originalScores = allRetrieverResults
          .map(({ retrieverName, results }) => {
            const found = results.find((r) => r.id === id);
            return found ? { retriever: retrieverName, score: found.score } : null;
          })
          .filter((x): x is { retriever: string; score: number } => x !== null);

        const retrievedBy = originalScores.map(x => x.retriever);

        return {
          id: doc.id,
          content: doc.content,
          score: score, // This is the fused score
          originalScores,
          retrievedBy,
        };
      }
    );

    // 4. Re-rank: Apply the specified reranker.
    const reranker = config.reranker || new PassthroughReranker();
    const finalResults = await reranker.rerank(hydratedResults, query);

    return finalResults;
  }
}
