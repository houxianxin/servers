interface RetrieverResult {
  id: string;
  content: string;
  score: number;
}

/**
 * A class responsible for fusing results from multiple retrievers.
 */
export class FusionEngine {
  /**
   * Fuses multiple sets of search results using Reciprocal Rank Fusion (RRF).
   * @param results - An array of result arrays, where each inner array is from one retriever.
   * @param k - The ranking constant for RRF, defaults to 60.
   * @returns A single, sorted array of results with their fused scores.
   */
  public static fuse(
    results: RetrieverResult[][],
    k: number = 60
  ): { id: string; score: number }[] {
    const rrfScores: Map<string, number> = new Map();

    // Iterate over each retriever's result set
    for (const resultSet of results) {
      // Iterate over each result in the set to calculate its RRF contribution
      for (let i = 0; i < resultSet.length; i++) {
        const result = resultSet[i];
        const rank = i + 1;
        const rrfScore = 1 / (k + rank);

        // Add the score to the existing score for this document, or initialize it
        rrfScores.set(
          result.id,
          (rrfScores.get(result.id) || 0) + rrfScore
        );
      }
    }

    // Convert the map to an array of { id, score } objects
    const fusedResults = Array.from(rrfScores.entries()).map(
      ([id, score]) => ({ id, score })
    );

    // Sort the results by the final RRF score in descending order
    fusedResults.sort((a, b) => b.score - a.score);

    return fusedResults;
  }
}
