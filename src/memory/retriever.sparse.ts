import lunr from 'lunr';
import { IRetriever } from './search.types.js';

interface IndexableDocument {
  id: string;
  content: string;
}

/**
 * A sparse retriever using lunr.js for in-memory, keyword-based search.
 */
export class SparseRetriever implements IRetriever {
  public readonly name = 'sparse';
  private index: lunr.Index;
  private documents: Map<string, IndexableDocument>;

  /**
   * Creates a new SparseRetriever.
   * @param docs The documents to be indexed.
   */
  constructor(docs: IndexableDocument[]) {
    this.documents = new Map(docs.map((doc) => [doc.id, doc]));

    this.index = lunr((builder) => {
      // `id` is the unique reference for our documents.
      builder.ref('id');
      // `content` is the field we want to search.
      builder.field('content');

      // Add each document to the index.
      docs.forEach((doc) => {
        builder.add(doc);
      });
    });
  }

  /**
   * Retrieves documents based on a keyword query.
   * @param query The search query.
   * @returns A promise that resolves to an array of search results.
   */
  public async retrieve(
    query: string
  ): Promise<{ id: string; content: string; score: number }[]> {
    const results = this.index.search(query);

    return results.map((result) => {
      const doc = this.documents.get(result.ref);
      if (!doc) {
        // This should not happen if the index is built correctly.
        throw new Error(`Document with ref ${result.ref} not found.`);
      }
      return {
        id: doc.id,
        content: doc.content,
        score: result.score,
      };
    });
  }
}
