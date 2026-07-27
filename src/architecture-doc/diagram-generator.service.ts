import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service';
import { FileRelationship, ModuleCluster } from './dto/hybrid-retrieval-context.dto';
import { DraftSection, ArchitectureDiagram } from './dto/architecture-draft.dto';
import { buildDiagramGenerationPrompt } from './templates/diagram-generation.prompt';

/**
 * Phase 2 internal drafting pipeline component.
 * Implements architecture diagram generation as specified in
 * `specs/003-architecture-drafting/contracts/drafting-pipeline.md`.
 * Exposes no public HTTP route, BullMQ processor, or controller.
 */
@Injectable()
export class DiagramGeneratorService {
  private readonly logger = new Logger(DiagramGeneratorService.name);

  constructor(private readonly gemini: GeminiService) {}

  async generate(
    relationships: FileRelationship[],
    clusters: ModuleCluster[],
    sections: DraftSection[],
  ): Promise<ArchitectureDiagram | null> {
    if (relationships.length === 0 && clusters.length === 0) {
      return null;
    }

    const prompt = buildDiagramGenerationPrompt(relationships, clusters, sections);
    const response = await this.gemini.generateContent(prompt);

    if (!this.isValidMermaid(response)) {
      return null;
    }

    const modules = this.extractModules(response, clusters);
    const validatedModules = this.validateModules(modules, clusters, relationships);

    return {
      mermaidSource: response.trim(),
      modules: validatedModules,
      verdict: validatedModules.length > 0 ? 'verified' : 'unverified',
      verificationNotes:
        validatedModules.length === 0 ? 'No evidenced modules found in diagram' : null,
    };
  }

  private isValidMermaid(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.startsWith('flowchart') || trimmed.startsWith('graph');
  }

  private extractModules(
    mermaid: string,
    clusters: ModuleCluster[],
  ): string[] {
    const modules = new Set<string>();

    for (const cluster of clusters) {
      if (mermaid.includes(cluster.name)) {
        modules.add(cluster.name);
      }
    }

    return Array.from(modules);
  }

  private validateModules(
    modules: string[],
    clusters: ModuleCluster[],
    relationships: FileRelationship[],
  ): string[] {
    const evidenceModules = new Set<string>();

    for (const cluster of clusters) {
      evidenceModules.add(cluster.name);
    }

    return modules.filter((m) => evidenceModules.has(m));
  }
}
