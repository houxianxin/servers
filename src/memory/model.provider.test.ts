import { jest, describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import { LocalModelProvider } from './model.provider.local.js';
import { ApiModelProvider } from './model.provider.api.js';

describe('Model Providers', () => {
  // TODO: Un-skip these tests once the environment issue is resolved.
  // These tests fail due to a fundamental incompatibility between the Jest/Node.js
  // test environment and the ONNX runtime used by @xenova/transformers.
  // The error is a `TypeError` related to an unexpected `Float32Array` type.
  // This was troubleshooted extensively, and skipping was approved by the user
  // to unblock the rest of the implementation.
  describe.skip('LocalModelProvider', () => {
    let provider: LocalModelProvider;

    // We give this a long timeout because downloading the model can be slow.
    beforeAll(async () => {
      provider = await LocalModelProvider.create({
        embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      });
    }, 30000);

    it('should create an instance', () => {
      expect(provider).toBeInstanceOf(LocalModelProvider);
    });

    it('should generate an embedding for a single string', async () => {
      const embedding = await provider.getEmbedding('hello world');
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 has 384 dimensions
      expect(typeof embedding[0]).toBe('number');
    });

    it('should generate embeddings for a batch of strings', async () => {
      const embeddings = await provider.getEmbeddings(['hello', 'world']);
      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings.length).toBe(2);
      expect(embeddings[0].length).toBe(384);
      expect(embeddings[1].length).toBe(384);
    });
  });

  describe('ApiModelProvider', () => {
    afterEach(() => {
      // Restore all mocks after each test to ensure test isolation
      jest.restoreAllMocks();
    });

    const config = {
      baseURL: 'https://api.test.com/v1',
      apiKey: 'test-key',
      embeddingModel: 'test-model',
    };

    it('should get a single embedding', async () => {
      const mockResponse = {
        data: [{ index: 0, embedding: [1, 2, 3] }],
      };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const provider = new ApiModelProvider(config);
      const embedding = await provider.getEmbedding('test');

      expect(embedding).toEqual([1, 2, 3]);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${config.baseURL}/embeddings`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should get batch embeddings and maintain order', async () => {
      const mockResponse = {
        data: [
          { index: 1, embedding: [4, 5, 6] }, // Respond out of order
          { index: 0, embedding: [1, 2, 3] },
        ],
      };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const provider = new ApiModelProvider(config);
      const embeddings = await provider.getEmbeddings(['first', 'second']);

      expect(embeddings).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
    });

    it('should handle API errors gracefully', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const provider = new ApiModelProvider(config);
      await expect(provider.getEmbedding('error test')).rejects.toThrow(
        'API request failed with status 500: Internal Server Error'
      );
    });
  });
});
