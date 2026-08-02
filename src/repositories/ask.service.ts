import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { collectionNameFor } from '../ai-provider/embedding-space.util';
import { ChromaService } from '../chroma/chroma.service';

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviderService: AiProviderService,
    private readonly chromaService: ChromaService,
  ) {}

  /**
   * Embeds the user's question, queries Chroma for context, and answers using the AI provider.
   */
  async ask(
    repositoryId: string,
    question: string,
  ): Promise<{ answer: string; citations: string[] }> {
    // 1. Verify repository exists
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    this.logger.log(
      `Received question for repository ${repositoryId}: "${question}"`,
    );

    // 2. Embed the question. Retrieval-time query embedding uses the
    // `search_query` input type so the gateway embeds in the query vector
    // space, matching the `search_document` vectors indexed earlier.
    const embedResult = await this.aiProviderService.embedString(
      question,
      'search_query',
    );

    // 3. Query the Chroma collection that matches this query's embedding
    // space. A fallback embedding (Gemini) must never be searched against
    // the primary collection (Bedrock) because the vector spaces differ.
    const collectionName = collectionNameFor(repositoryId, embedResult);
    if (!(await this.chromaService.collectionExists(collectionName))) {
      this.logger.warn(
        `No "${collectionName}" collection for repository ${repositoryId} in embedding space "${embedResult.provider}" (${embedResult.dimensions}-dim); skipping semantic retrieval`,
      );
      return {
        answer:
          'This repository does not have any indexed documentation yet. Please run documentation generation first.',
        citations: [],
      };
    }

    const queryResult = await this.chromaService.queryCollection(
      collectionName,
      embedResult.embedding,
      5, // Top-K results
    );

    const documents = queryResult.documents[0] || [];
    const metadatas = queryResult.metadatas[0] || [];

    if (documents.length === 0) {
      this.logger.warn(
        `No relevant chunks found in Chroma for repository ${repositoryId}`,
      );
      return {
        answer:
          'This repository does not have any indexed documentation yet. Please run documentation generation first.',
        citations: [],
      };
    }

    // 4. Construct context and citations
    let context = '';
    const citationsSet = new Set<string>();

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const metadata = metadatas[i] as Record<string, any> | undefined;
      const filePath = metadata?.filePath || 'unknown';

      citationsSet.add(filePath);
      context += `File Path: ${filePath}\nDocumentation Chunk:\n${doc}\n\n`;
    }

    // 5. Ask the AI provider to answer the question using the context
    const answer = (
      await this.aiProviderService.answerQuestion(question, context)
    ).text;

    return {
      answer,
      citations: Array.from(citationsSet),
    };
  }
}
