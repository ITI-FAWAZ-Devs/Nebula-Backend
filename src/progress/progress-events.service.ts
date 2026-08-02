import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnalysisJob, DocumentationJob } from '@prisma/client';

export type ProgressEventName =
  'analysis' | 'documentation' | 'architecture-doc';

export interface ProgressEvent {
  name: ProgressEventName;
  data: unknown;
}

export interface ArchDocProgressPayload {
  jobId: string;
  docId: string;
  status: string;
  errorMessage: string | null;
}

const EVENT_NAMES: ProgressEventName[] = [
  'analysis',
  'documentation',
  'architecture-doc',
];

@Injectable()
export class ProgressEventsService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  private channel(repositoryId: string, name: ProgressEventName): string {
    return `${name}.${repositoryId}`;
  }

  publishAnalysis(repositoryId: string, job: AnalysisJob): void {
    this.eventEmitter.emit(this.channel(repositoryId, 'analysis'), job);
  }

  publishDocumentation(repositoryId: string, job: DocumentationJob): void {
    this.eventEmitter.emit(this.channel(repositoryId, 'documentation'), job);
  }

  publishArchDoc(repositoryId: string, payload: ArchDocProgressPayload): void {
    this.eventEmitter.emit(
      this.channel(repositoryId, 'architecture-doc'),
      payload,
    );
  }

  subscribe(
    repositoryId: string,
    listener: (event: ProgressEvent) => void,
  ): () => void {
    const handlers = EVENT_NAMES.map((name) => {
      const channel = this.channel(repositoryId, name);
      const handler = (data: unknown) => listener({ name, data });
      this.eventEmitter.on(channel, handler);
      return { channel, handler };
    });

    return () => {
      for (const { channel, handler } of handlers) {
        this.eventEmitter.off(channel, handler);
      }
    };
  }
}
