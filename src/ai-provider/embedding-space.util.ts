import {
  AiEmbeddingBatchResult,
  AiEmbeddingResult,
} from './interfaces/ai-provider-result.interface';

/**
 * Embedding vectors from different providers/models live in different vector
 * spaces (e.g. Gemini = 768-dim, OpenRouter Nemotron = 2048-dim). They are NOT
 * comparable and must never be mixed in a single similarity search.
 *
 * Primary-provider embeddings are stored in the primary collection
 * (`repo-<id>`). Fallback embeddings are quarantined into a per-space
 * collection (`repo-<id>-quarantine-<provider>-<model>-<dims>d`) so vectors
 * from different fallback providers are never mixed either, and must be
 * re-embedded once the primary provider is healthy again (re-indexing is a
 * separate task).
 */
export const QUARANTINE_COLLECTION_SUFFIX = '-quarantine';

/**
 * Chroma collection names allow a restricted character set, so the model id
 * (which can contain `/`, `:`, `.`, etc.) is slugified.
 */
function modelSlug(model: string): string {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function collectionNameFor(
  repositoryId: string,
  embedding: Pick<
    AiEmbeddingResult,
    'fallbackOccurred' | 'provider' | 'model' | 'dimensions'
  >,
): string {
  if (!embedding.fallbackOccurred) return `repo-${repositoryId}`;
  const provider = embedding.provider || 'unknown';
  const slug = modelSlug(embedding.model);
  const dims = embedding.dimensions || 0;
  return `repo-${repositoryId}${QUARANTINE_COLLECTION_SUFFIX}-${provider}-${slug}-${dims}d`;
}

/**
 * Metadata stored on every vector so the embedding space is explicit and
 * auditable in ChromaDB.
 */
export function embeddingSpaceMetadata(
  batch: Pick<AiEmbeddingBatchResult, 'provider' | 'model' | 'dimensions'>,
): Record<string, unknown> {
  return {
    embeddingProvider: batch.provider,
    embeddingModel: batch.model,
    embeddingDimensions: batch.dimensions,
  };
}

/**
 * ChromaDB Cloud enforces a strict 128-byte quota limit on record IDs.
 * Generates a deterministic chunk ID for a file path that is guaranteed to stay <= 128 bytes.
 */
export function chunkIdForFilePath(filePath: string): string {
  if (Buffer.byteLength(filePath, 'utf8') <= 120) {
    return filePath;
  }
  // For unusually deep file paths (> 120 bytes), truncate and append a hash to prevent ID quota violations.
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = (hash * 31 + filePath.charCodeAt(i)) >>> 0;
  }
  const hexHash = hash.toString(16).padStart(8, '0');
  return `${filePath.slice(0, 100)}_${hexHash}`;
}
