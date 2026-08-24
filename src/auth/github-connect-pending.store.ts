import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface GithubConnectPendingPayload {
  accessToken: string;
  githubLogin: string;
  githubId: string;
  user: unknown;
  orgs: unknown[];
  userId: string | null;
  workspace: string;
  organizationId: string | null;
  existingLogins: string[];
  returnTo: string;
  /** 'add-org' when initiated from GET /auth/github/connect/add-org */
  flow?: string | null;
}

type StoreEntry = { data: GithubConnectPendingPayload; expiresAt: number };

@Injectable()
export class GithubConnectPendingStore {
  private readonly logger = new Logger(GithubConnectPendingStore.name);
  private readonly filePath = join(
    tmpdir(),
    'nebula-github-connect-pending.json',
  );
  private readonly ttlMs = 10 * 60 * 1000;
  private store = new Map<string, StoreEntry>();

  constructor() {
    this.loadFromDisk();
  }

  set(data: GithubConnectPendingPayload): string {
    this.loadFromDisk();
    this.prune();
    const id = randomUUID();
    this.store.set(id, { data, expiresAt: Date.now() + this.ttlMs });
    this.saveToDisk();
    return id;
  }

  get(id: string): GithubConnectPendingPayload | null {
    this.loadFromDisk();
    const entry = this.store.get(id);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(id);
      this.saveToDisk();
      return null;
    }
    return entry.data;
  }

  delete(id: string): void {
    this.loadFromDisk();
    this.store.delete(id);
    this.saveToDisk();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) this.store.delete(key);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<
        string,
        StoreEntry
      >;
      this.store = new Map(Object.entries(parsed ?? {}));
      this.prune();
    } catch (err) {
      this.logger.warn(
        `Could not read pending GitHub connect sessions: ${err}`,
      );
    }
  }

  private saveToDisk(): void {
    try {
      mkdirSync(tmpdir(), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(Object.fromEntries(this.store)),
        'utf8',
      );
    } catch (err) {
      this.logger.warn(
        `Could not persist pending GitHub connect sessions: ${err}`,
      );
    }
  }
}
