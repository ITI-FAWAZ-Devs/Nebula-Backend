export interface TTSProvider {
  /** Synthesize text and emit audio via `onAudio` callback. Resolves when done. */
  speak(text: string): Promise<void>;
  /** Immediately stop any in-progress synthesis */
  stop(): Promise<void>;
  /** Returns true when synthesis is ongoing */
  isSpeaking(): boolean;
  /** Register a callback for each audio chunk (WAV/PCM bytes) */
  onAudio(callback: (chunk: Buffer) => void): void;
}

export const TTS_PROVIDER = 'TTS_PROVIDER';
