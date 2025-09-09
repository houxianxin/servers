import {
  IReranker,
  SearchResultItem,
  IModelProvider,
} from './search.types.js';

/**
 * A reranker that does nothing and simply passes the results through.
 * This is the default reranker.
 */
export class PassthroughReranker implements IReranker {
  public async rerank(
    results: SearchResultItem[],
    query: string
  ): Promise<SearchResultItem[]> {
    // No-op, just return the results as they are.
    return results;
  }
}

/**
 * A skeleton for a reranker that uses a powerful Cross-Encoder model.
 * (Not fully implemented in this version).
 */
export class CrossEncoderReranker implements IReranker {
  private modelProvider: IModelProvider;
  private topN: number;

  constructor(modelProvider: IModelProvider, topN: number = 25) {
    this.modelProvider = modelProvider;
    this.topN = topN;
  }

  public async rerank(
    results: SearchResultItem[],
    query: string
  ): Promise<SearchResultItem[]> {
    // TODO: Implement the full cross-encoder reranking logic.
    //
    // The logic would be:
    // 1. Take the top N results from the input `results`.
    // 2. For each of the top N results, create a pair: [query, result.content].
    // 3. Call `this.modelProvider.getCrossEncoderScore(query, result.content)` for each pair.
    //    - This method needs to be implemented in the model providers.
    // 4. Re-sort the top N results based on the new cross-encoder scores.
    // 5. Concatenate the re-sorted top N results with the rest of the original results.
    // 6. Return the final, combined list.

    // For now, as a skeleton, we just pass the results through.
    return results;
  }
}
