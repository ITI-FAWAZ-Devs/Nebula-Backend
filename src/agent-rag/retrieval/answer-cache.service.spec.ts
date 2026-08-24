import { Test, TestingModule } from '@nestjs/testing';
import { AnswerCacheService } from './answer-cache.service';
import { RedisService } from '../../redis/redis.service';

describe('AnswerCacheService', () => {
  let service: AnswerCacheService;
  let mockRedis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnswerCacheService,
        {
          provide: RedisService,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<AnswerCacheService>(AnswerCacheService);
  });

  it('should return null when cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await service.get('repo-1', 'How does auth work?');
    expect(result).toBeNull();
    expect(mockRedis.get).toHaveBeenCalled();
  });

  it('should parse and return cached result on hit', async () => {
    const cachedData = {
      answer: 'Auth uses JWT',
      citations: [],
      citedNodeIds: [],
      toolsUsed: ['hybrid_search'],
      contextNodeIds: [],
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

    const result = await service.get('repo-1', 'How does auth work?');
    expect(result).toEqual(cachedData);
  });

  it('should save answer with TTL to redis', async () => {
    const answerData = {
      answer: 'Auth uses JWT',
      citations: [],
      citedNodeIds: [],
      toolsUsed: ['hybrid_search'],
      contextNodeIds: [],
    };

    await service.set('repo-1', 'How does auth work?', answerData);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('agent-answer:repo-1:'),
      JSON.stringify(answerData),
      300,
    );
  });
});
