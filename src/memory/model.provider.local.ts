import {
    pipeline,
    env,
    FeatureExtractionPipeline,
  } from '@xenova/transformers';
  import {
    IModelProvider,
    LocalModelProviderConfig,
  } from './search.types.js';

  // Allow the library to use its default behavior for loading models.
  // In a Node.js environment, it will use a WASM-based backend.
  env.allowLocalModels = true;

  /**
   * A model provider that runs embedding models locally using @xenova/transformers.
   */
  export class LocalModelProvider implements IModelProvider {
    private extractor: FeatureExtractionPipeline;

    // Private constructor to enforce initialization via the async `create` method.
    private constructor(extractor: FeatureExtractionPipeline) {
      this.extractor = extractor;
    }

    /**
     * Asynchronously creates and initializes a LocalModelProvider.
     * This is necessary because loading the transformer model is an async operation.
     * @param config Configuration for the local model provider.
     * @returns A promise that resolves to a new LocalModelProvider instance.
     */
    public static async create(
      config: LocalModelProviderConfig
    ): Promise<LocalModelProvider> {
      const extractor = (await pipeline(
        'feature-extraction',
        config.embeddingModel
      )) as FeatureExtractionPipeline;

      return new LocalModelProvider(extractor);
    }

    /**
     * Generates an embedding for a single piece of text.
     * @param text The text to embed.
     * @returns A promise that resolves to the embedding vector.
     */
    public async getEmbedding(text: string): Promise<number[]> {
      const result = await this.extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      return Array.from(result.data as Float32Array);
    }

    /**
     * Generates embeddings for a batch of texts.
     * @param texts An array of texts to embed.
     * @returns A promise that resolves to an array of embedding vectors.
     */
    public async getEmbeddings(texts: string[]): Promise<number[][]> {
      const result = await this.extractor(texts, {
        pooling: 'mean',
        normalize: true,
      });

      const batchSize = result.dims[0];
      const embeddingDim = result.dims[1];
      const flatData = Array.from(result.data as Float32Array);

      const embeddings: number[][] = [];
      for (let i = 0; i < batchSize; i++) {
        embeddings.push(flatData.slice(i * embeddingDim, (i + 1) * embeddingDim));
      }

      return embeddings;
    }
  }
