/**
 * Embedding mode the SBG gateway needs to distinguish. `search_document` is
 * used when indexing chunks into the vector store; `search_query` is used
 * when embedding a retrieval-time query. Mixing them silently degrades
 * retrieval quality, so call sites must set the correct one.
 */
export type EmbeddingInputType = 'search_document' | 'search_query';

export interface EmbeddingProviderOptions {
  overrideModel?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embedString(
    text: string,
    inputType?: EmbeddingInputType,
    options?: EmbeddingProviderOptions,
  ): Promise<number[]>;
  embedMany(
    texts: string[],
    inputType?: EmbeddingInputType,
    options?: EmbeddingProviderOptions,
  ): Promise<number[][]>;
}
