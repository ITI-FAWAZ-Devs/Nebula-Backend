import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TavilySearchService } from './tavily-search.service';

describe('TavilySearchService', () => {
  let service: TavilySearchService;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  async function build(apiKey?: string) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TavilySearchService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(apiKey) },
        },
      ],
    }).compile();
    service = module.get(TavilySearchService);
  }

  it('returns an empty list when TAVILY_API_KEY is unset', async () => {
    await build(undefined);
    expect(service.isAvailable).toBe(false);
    const results = await service.search('what is electron');
    expect(results).toEqual([]);
  });

  it('maps Tavily search results', async () => {
    await build('tvly-test');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Electron docs',
            url: 'https://www.electronjs.org/docs',
            content: 'Electron uses a multi-process model.',
            score: 0.91,
          },
        ],
      }),
    });

    const results = await service.search('multi-process model', 3);

    expect(results).toEqual([
      {
        title: 'Electron docs',
        url: 'https://www.electronjs.org/docs',
        snippet: 'Electron uses a multi-process model.',
        score: 0.91,
      },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tvly-test',
        }),
      }),
    );
  });

  it('returns an empty list on HTTP failure', async () => {
    await build('tvly-test');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(service.search('query')).resolves.toEqual([]);
  });
});
