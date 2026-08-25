import { Test, TestingModule } from '@nestjs/testing';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';
import { PrismaService } from '../prisma/prisma.service';
import { Neo4jService } from '../neo4j/neo4j.service';

describe('GraphController', () => {
  let controller: GraphController;
  let graphService: GraphService;

  const mockPrisma = {
    repository: {
      findFirst: jest.fn().mockResolvedValue({ id: 'repo-1', userId: 'user-1' }),
    },
  };

  const mockNeo4j = {
    getArchitectureGraph: jest.fn().mockResolvedValue({
      nodes: [{ id: 'n1', name: 'App' }],
      edges: [],
    }),
    getGraphOverview: jest.fn().mockResolvedValue({
      totalNodes: 10,
      totalRelationships: 15,
      labelsCount: {},
      topHubs: [],
    }),
    getCircularDependencies: jest.fn().mockResolvedValue([
      { cycle: ['a.ts', 'b.ts', 'a.ts'], cycleLength: 2 },
    ]),
    getImpactAnalysis: jest.fn().mockResolvedValue([
      { dependentFile: 'src/app.ts', depth: 1, relationshipTypes: ['IMPORTS'] },
    ]),
    getDeadCode: jest.fn().mockResolvedValue([
      { id: 'f1', name: 'unusedFunc', filePath: 'src/utils.ts', label: 'Function' },
    ]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GraphController],
      providers: [
        GraphService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: Neo4jService, useValue: mockNeo4j },
      ],
    }).compile();

    controller = module.get<GraphController>(GraphController);
    graphService = module.get<GraphService>(GraphService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns architecture graph', async () => {
    const res = await controller.getArchitectureGraph('user-1', 'repo-1', undefined, '100');
    expect(res.success).toBe(true);
    expect(res.data.nodes).toHaveLength(1);
    expect(mockNeo4j.getArchitectureGraph).toHaveBeenCalledWith('repo-1', {
      moduleId: undefined,
      maxNodes: 100,
    });
  });

  it('returns graph overview', async () => {
    const res = await controller.getGraphOverview('user-1', 'repo-1');
    expect(res.success).toBe(true);
    expect(res.data.totalNodes).toBe(10);
  });

  it('returns circular dependencies', async () => {
    const res = await controller.getCircularDependencies('user-1', 'repo-1', '5');
    expect(res.success).toBe(true);
    expect(res.data.cyclesCount).toBe(1);
  });

  it('returns impact analysis for a file', async () => {
    const res = await controller.getImpactAnalysis('user-1', 'repo-1', 'src/auth.ts', '3');
    expect(res.success).toBe(true);
    expect(res.data.targetFile).toBe('src/auth.ts');
    expect(res.data.dependentCount).toBe(1);
  });

  it('returns dead code', async () => {
    const res = await controller.getDeadCode('user-1', 'repo-1');
    expect(res.success).toBe(true);
    expect(res.data.deadCodeCount).toBe(1);
  });
});
