export interface STTProvider {
  /** Start listening / accepting audio */
  start(): Promise<void>;
  /** Stop listening; flushes any pending audio */
  stop(): Promise<void>;
  /** Push a raw PCM chunk (16 kHz, 16-bit, mono) from the client */
  pushAudio(chunk: Buffer): void;
  /** Called continuously with partial (in-progress) transcript text */
  onPartial(callback: (text: string) => void): void;
  /** Called once per utterance with the final committed transcript */
  onFinal(callback: (text: string) => void): void;
}

export const STT_PROVIDER = 'STT_PROVIDER';
