import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../gemini/gemini.service';
import { ChromaService } from '../chroma/chroma.service';

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
    private readonly chromaService: ChromaService,
  ) {}

  /**
   * Embeds the user's question, queries Chroma for context, and answers using Gemini.
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

    this.logger.log(`Received question for repository ${repositoryId}: "${question}"`);

    // 2. Embed the question
    const questionEmbedding = await this.geminiService.embedString(question);

    // 3. Query the Chroma collection
    const collectionName = `repo-${repositoryId}`;
    const queryResult = await this.chromaService.queryCollection(
      collectionName,
      questionEmbedding,
      5, // Top-K results
    );

    const documents = queryResult.documents[0] || [];
    const metadatas = queryResult.metadatas[0] || [];

    if (documents.length === 0) {
      this.logger.warn(`No relevant chunks found in Chroma for repository ${repositoryId}`);
      return {
        answer: "This repository does not have any indexed documentation yet. Please run documentation generation first.",
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

    // 5. Ask Gemini to answer the question using the context
    const answer = await this.geminiService.answerQuestion(question, context);

    return {
      answer,
      citations: Array.from(citationsSet),
    };
  }
}
