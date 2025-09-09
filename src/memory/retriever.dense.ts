import { IModelProvider, IRetriever } from './search.types.js';

interface VectorDocument {
  id: string;
  content: string;
  vector: number[];
}

/**
 * Calculates the cosine similarity between two vectors.
 * @param vecA The first vector.
 * @param vecB The second vector.
 * @returns The cosine similarity score.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same dimension.');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0; // Avoid division by zero
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * A dense retriever that performs semantic search using vector embeddings.
 */
export class DenseRetriever implements IRetriever {
  public readonly name = 'dense';
  private modelProvider: IModelProvider;
  private documents: VectorDocument[];
  private topK: number;

  /**
   * Creates a new DenseRetriever.
   * @param modelProvider The model provider to use for generating query embeddings.
   * @param documents An array of documents with their pre-computed vectors.
   * @param topK The number of top results to return.
   */
  constructor(
    modelProvider: IModelProvider,
    documents: VectorDocument[],
    topK: number = 10
  ) {
    this.modelProvider = modelProvider;
    this.documents = documents;
    this.topK = topK;
  }

  /**
   * Retrieves documents based on semantic similarity to the query.
   * @param query The search query.
   * @returns A promise that resolves to an array of search results.
   */
  public async retrieve(
    query: string
  ): Promise<{ id: string; content: string; score: number }[]> {
    const queryVector = await this.modelProvider.getEmbedding(query);

    const scoredDocs = this.documents.map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryVector, doc.vector),
    }));

    // Sort by score in descending order
    scoredDocs.sort((a, b) => b.score - a.score);

    // Return the top K results
    return scoredDocs.slice(0, this.topK).map(({ id, content, score }) => ({
      id,
      content,
      score,
    }));
  }
}
