import {
  collectionNameFor,
  embeddingSpaceMetadata,
  chunkIdForFilePath,
} from './embedding-space.util';

describe('collectionNameFor', () => {
  it('should use the primary collection when no fallback occurred', () => {
    expect(
      collectionNameFor('repo-123', {
        provider: 'bedrock',
        model: 'us.cohere.embed-v4:0',
        dimensions: 1024,
        fallbackOccurred: false,
      }),
    ).toBe('repo-repo-123');
  });

  it('should quarantine per provider/model/dimensions on fallback', () => {
    expect(
      collectionNameFor('repo-123', {
        provider: 'gemini',
        model: 'text-embedding-004',
        dimensions: 768,
        fallbackOccurred: true,
      }),
    ).toBe('repo-repo-123-quarantine-gemini-text-embedding-004-768d');
  });

  it('should slugify provider model ids that contain special characters', () => {
    expect(
      collectionNameFor('repo-123', {
        provider: 'openrouter',
        model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        dimensions: 2048,
        fallbackOccurred: true,
      }),
    ).toBe(
      'repo-repo-123-quarantine-openrouter-nvidia-llama-nemotron-embed-vl-1b-v2-free-2048d',
    );
  });

  it('should never mix two fallback providers in one collection', () => {
    const gemini = collectionNameFor('repo-123', {
      provider: 'gemini',
      model: 'text-embedding-004',
      dimensions: 768,
      fallbackOccurred: true,
    });
    const openrouter = collectionNameFor('repo-123', {
      provider: 'openrouter',
      model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      dimensions: 2048,
      fallbackOccurred: true,
    });

    expect(gemini).not.toBe(openrouter);
  });
});

describe('embeddingSpaceMetadata', () => {
  it('should tag vectors with provider, model and dimensions', () => {
    expect(
      embeddingSpaceMetadata({
        provider: 'openrouter',
        model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
        dimensions: 2048,
      }),
    ).toEqual({
      embeddingProvider: 'openrouter',
      embeddingModel: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      embeddingDimensions: 2048,
    });
  });
});

describe('chunkIdForFilePath', () => {
  it('should return the original file path when <= 120 bytes', () => {
    const path = 'src/features/auth/auth.service.ts';
    expect(chunkIdForFilePath(path)).toBe(path);
  });

  it('should truncate and append hash when path > 120 bytes to stay <= 128 bytes', () => {
    const longPath = 'src/features/administrative-workflows/approvals/controllers/internal-review-board-digital-system-submission-with-a-very-long-file-name-that-exceeds-the-quota.controller.ts';
    const id = chunkIdForFilePath(longPath);
    expect(Buffer.byteLength(id, 'utf8')).toBeLessThanOrEqual(128);
    expect(id.startsWith(longPath.slice(0, 100))).toBe(true);
  });
});
