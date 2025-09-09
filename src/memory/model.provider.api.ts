import { IModelProvider, ApiModelProviderConfig } from './search.types.js';

/**
 * A model provider that uses an external, OpenAI-compatible API for embeddings.
 */
export class ApiModelProvider implements IModelProvider {
  private config: ApiModelProviderConfig;

  constructor(config: ApiModelProviderConfig) {
    this.config = config;
  }

  /**
   * Generates an embedding for a single piece of text by calling an external API.
   * @param text The text to embed.
   * @returns A promise that resolves to the embedding vector.
   */
  public async getEmbedding(text: string): Promise<number[]> {
    const response = await this.makeApiCall([text]);
    return response[0];
  }

  /**
   * Generates embeddings for a batch of texts by calling an external API.
   * @param texts An array of texts to embed.
   * @returns A promise that resolves to an array of embedding vectors.
   */
  public async getEmbeddings(texts: string[]): Promise<number[][]> {
    return this.makeApiCall(texts);
  }

  /**
   * Handles the actual API call to the embedding endpoint.
   * @param inputs An array of texts to be embedded.
   * @returns A promise that resolves to an array of embeddings.
   */
  private async makeApiCall(inputs: string[]): Promise<number[][]> {
    const { baseURL, apiKey, embeddingModel } = this.config;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetch(`${baseURL}/embeddings`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          input: inputs,
          model: embeddingModel,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `API request failed with status ${response.status}: ${errorBody}`
        );
      }

      const json = await response.json();

      // The OpenAI-compatible format returns a list of embedding objects.
      // We need to sort them by index to ensure the order is correct.
      const sortedEmbeddings = json.data.sort((a: any, b: any) => a.index - b.index);

      return sortedEmbeddings.map((item: any) => item.embedding);

    } catch (error) {
      console.error('Failed to fetch embeddings from API:', error);
      throw error;
    }
  }
}
