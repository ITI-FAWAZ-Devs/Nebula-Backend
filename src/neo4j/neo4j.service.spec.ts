import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from './neo4j.service';

describe('Neo4jService', () => {
  let service: Neo4jService;

  const mockSession = {
    run: jest.fn(),
    close: jest.fn(),
  };

  const mockDriver = {
    session: jest.fn().mockReturnValue(mockSession),
    close: jest.fn(),
    verifyConnectivity: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string | undefined> = {
        'neo4j.uri': 'bolt://localhost:7687',
        'neo4j.username': 'neo4j',
        'neo4j.password': 'password',
        'neo4j.database': 'neo4j',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Neo4jService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    })
      .overrideProvider(Neo4jService)
      .useFactory({
        factory: () => {
          const svc = new Neo4jService(
            mockConfigService as unknown as ConfigService,
          );
          (svc as any).driver = mockDriver;
          return svc;
        },
      })
      .compile();

    service = module.get<Neo4jService>(Neo4jService);
    jest.clearAllMocks();
  });

  describe('getFileNeighborhood', () => {
    const repositoryId = 'repo-123';
    const seedPaths = ['src/main.ts', 'src/utils/helper.ts'];
    const maxHops = 1;

    it('should include repositoryId, seedPaths, and maxHops in query parameters', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      await service.getFileNeighborhood(repositoryId, seedPaths, maxHops);

      const callParams = mockSession.run.mock.calls[0][1];
      expect(callParams.repositoryId).toBe(repositoryId);
      expect(callParams.seedPaths).toEqual(seedPaths);
      expect(callParams.maxHops).toBeDefined();
    });

    it('should close the session after a successful result', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      await service.getFileNeighborhood(repositoryId, seedPaths, maxHops);

      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });

    it('should close the session when a query error is thrown', async () => {
      mockSession.run.mockRejectedValue(new Error('Query failed'));

      await expect(
        service.getFileNeighborhood(repositoryId, seedPaths, maxHops),
      ).rejects.toThrow('Query failed');

      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });
  });
});
