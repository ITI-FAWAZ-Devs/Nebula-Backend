import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TavilyResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

@Injectable()
export class TavilySearchService {
  private readonly logger = new Logger(TavilySearchService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.tavily.com/search';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('TAVILY_API_KEY');
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, maxResults = 4): Promise<TavilyResult[]> {
    if (!this.apiKey) {
      this.logger.debug('TAVILY_API_KEY not set — web_search skipped');
      return [];
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(maxResults, 5),
          search_depth: 'basic',
          include_answer: false,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Tavily request failed: HTTP ${response.status} ${response.statusText}`,
        );
        return [];
      }

      const data = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          score?: number;
        }>;
      };

      return (data.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
        score: typeof r.score === 'number' ? r.score : 0,
      }));
    } catch (error) {
      this.logger.warn(
        `Tavily search error for "${query.slice(0, 80)}": ${(error as Error).message}`,
      );
      return [];
    }
  }
}
