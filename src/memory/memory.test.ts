import { jest } from '@jest/globals';
import { FileKnowledgeGraphManager } from './file.manager.js';
import { Neo4jKnowledgeGraphManager } from './neo4j.manager.js';
import * as Neo4jManager from './neo4j.manager.js';
import { IKnowledgeGraphManager, EntityV1, isV2Entity, ObservationV2 } from './types.js';
import { promises as fs } from 'fs';
import path from 'path';

// --- Mocks ---
const mockTxRun = jest.fn();
const mockSession = {
  executeRead: jest.fn((callback: any) => callback({ run: mockTxRun })),
  executeWrite: jest.fn((callback: any) => callback({ run: mockTxRun })),
  close: jest.fn(),
};
jest.mock('neo4j-driver', () => ({
  driver: jest.fn(() => ({
    session: () => mockSession,
    verifyConnectivity: jest.fn().mockResolvedValue({} as any),
    close: jest.fn(),
  })),
  auth: { basic: jest.fn() },
}));
jest.mock('crypto', () => ({
    ...jest.requireActual('crypto'),
    randomUUID: () => 'mock-uuid-1234'
}));
// --- End Mocks ---

const TEST_MEMORY_FILE = path.join(process.cwd(), 'test_memory_v2.json');

describe('V2 KnowledgeGraphManager Implementations', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockTxRun.mockClear();
    process.env.NEO4J_URI = 'neo4j://localhost';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';
  });

  describe('FileKnowledgeGraphManager', () => {
    let manager: IKnowledgeGraphManager;

    beforeEach(async () => {
      process.env.MEMORY_FILE_PATH = TEST_MEMORY_FILE;
      manager = new FileKnowledgeGraphManager();
      try {
        await fs.unlink(TEST_MEMORY_FILE);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    });

    it('should create a V2 entity from V1-like input', async () => {
      const v1Input = { name: 'test-entity', entityType: 'test', observations: ['obs1'] };
      await manager.createEntities([v1Input]);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1);
      const entity = graph.entities[0];

      expect(isV2Entity(entity)).toBe(true);
      expect(entity.tags).toEqual(['test']);
      expect(entity.observations[0].content).toBe('obs1');
      expect(entity.observations[0].source).toBe('createEntities');
    });

    it('should upgrade a V1 entity on write', async () => {
        const v1Entity: EntityV1 = { name: 'v1-entity', entityType: 'legacy', observations: ['old obs'] };
        await fs.writeFile(TEST_MEMORY_FILE, JSON.stringify({type: 'entity', ...v1Entity}));

        await manager.addObservations([{ entityName: 'v1-entity', contents: ['new obs'] }]);

        const graph = await manager.readGraph();
        expect(graph.entities).toHaveLength(1);
        const entity = graph.entities[0];

        expect(isV2Entity(entity)).toBe(true);
        expect(entity.tags).toEqual(['legacy']);
        expect(entity.observations).toHaveLength(2);
        expect(entity.observations.map((o: ObservationV2) => o.content)).toEqual(['old obs', 'new obs']);
        expect(entity.observations[0].source).toBe('legacy_import');
        expect(entity.observations[1].source).toBe('addObservations');
    });
  });

  describe('Neo4jKnowledgeGraphManager', () => {
    let manager: Neo4jKnowledgeGraphManager;

    beforeEach(async () => {
        const initSpy = jest.spyOn(Neo4jKnowledgeGraphManager.prototype as any, 'init').mockImplementation(async function(this: any) {
            this.connected = true;
        });
        manager = new Neo4jKnowledgeGraphManager();
        await initSpy.mock.results[0].value;
        initSpy.mockRestore();
    });

    it('should create a V2 entity with vector', async () => {
        const embeddingSpy = jest.spyOn(Neo4jManager, 'getEmbedding').mockResolvedValue([0.1, 0.2]);
        mockTxRun.mockResolvedValue({ records: [] } as any);

        const v1Input = { name: 'test-entity', entityType: 'TestType', observations: ['obs1'] };
        await manager.createEntities([v1Input]);

        expect(mockSession.executeWrite).toHaveBeenCalled();
        const params = mockTxRun.mock.calls[0][1];

        expect(params.entities[0].vector).toEqual([0.1, 0.2]);
        embeddingSpy.mockRestore();
    });

    it('should upgrade a V1 entity on addObservations', async () => {
        const embeddingSpy = jest.spyOn(Neo4jManager, 'getEmbedding').mockResolvedValue([0.3, 0.4]);
        const v1Entity: EntityV1 = { name: 'v1-entity', entityType: 'legacy', observations: ['old obs'] };

        const mockRecord = { get: () => ({ properties: v1Entity }) };
        mockTxRun.mockResolvedValueOnce({ records: [mockRecord] } as any);
        mockTxRun.mockResolvedValueOnce({ records: [] } as any);

        await manager.addObservations([{ entityName: 'v1-entity', contents: ['new obs'] }]);

        expect(mockSession.executeWrite).toHaveBeenCalled();
        const writeParams = mockTxRun.mock.calls[1][1];

        expect(writeParams.updates[0].name).toBe('v1-entity');
        expect(writeParams.updates[0].vector).toEqual([0.3, 0.4]);
        embeddingSpy.mockRestore();
    });
  });
});
