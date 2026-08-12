import { Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STTProvider } from './stt-provider.interface';

/**
 * WhisperSTTProvider
 *
 * Per-session instance. Accumulates raw PCM chunks (16 kHz, 16-bit, mono LE)
 * from the client. When `commitUtterance()` is called it wraps the buffer in
 * a WAV file, writes it to a temp path, runs whisper-cli, reads stdout, and
 * emits the transcript via the `onFinal` callback.
 */
export class WhisperSTTProvider implements STTProvider {
  private readonly logger = new Logger(WhisperSTTProvider.name);

  private partialCallback: ((text: string) => void) | null = null;
  private finalCallback: ((text: string) => void) | null = null;

  private audioBuffer: Buffer[] = [];
  private running = false;

  constructor(
    private readonly whisperBin: string,
    private readonly whisperModel: string,
    private readonly sampleRate: number,
  ) {}

  start(): Promise<void> {
    this.audioBuffer = [];
    this.running = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.running = false;
    this.audioBuffer = [];
    return Promise.resolve();
  }

  pushAudio(chunk: Buffer): void {
    if (!this.running) return;
    this.audioBuffer.push(chunk);
    // Emit lightweight partial so UI waveform stays animated
    this.partialCallback?.(`__bytes:${this.totalBytes()}`);
  }

  /** Flush buffered audio through whisper-cli and emit the transcript. */
  async commitUtterance(): Promise<void> {
    if (!this.running || this.audioBuffer.length === 0) return;

    const pcm = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];

    if (pcm.byteLength < 3200) {
      // Less than 0.1 s of audio — too short to transcribe meaningfully
      this.logger.debug('Utterance too short, skipping transcription');
      return;
    }

    const wav = buildWavBuffer(pcm, this.sampleRate);
    const tmpFile = path.join(
      os.tmpdir(),
      `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
    );

    try {
      fs.writeFileSync(tmpFile, wav);
      const text = await this.runWhisper(tmpFile);
      if (text) {
        this.logger.debug(`Whisper: "${text.slice(0, 120)}"`);
        this.finalCallback?.(text);
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  onPartial(callback: (text: string) => void): void {
    this.partialCallback = callback;
  }

  onFinal(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }

  private totalBytes(): number {
    return this.audioBuffer.reduce((s, b) => s + b.byteLength, 0);
  }

  private runWhisper(wavFile: string): Promise<string> {
    return new Promise((resolve) => {
      // -nt  no timestamps (default true, but explicit)
      // -np  no prints: suppress progress/info, keeps only the transcript line
      const args = [
        '-f',
        wavFile,
        '-m',
        this.whisperModel,
        '-nt',
        '-np',
        '-l',
        'en',
      ];

      const proc = spawn(this.whisperBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });

      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          this.logger.warn(
            `whisper-cli exited ${code}: ${stderr.slice(0, 300)}`,
          );
        }

        // Strip residual timestamp markers and Whisper special tokens
        const text = stdout
          .replace(/\[[\d:., ->]+\]/g, '')
          .replace(/\[[A-Z_]+\]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        resolve(text);
      });

      proc.on('error', (err) => {
        this.logger.error(`whisper-cli spawn error: ${err.message}`);
        resolve('');
      });
    });
  }
}

// ─── WAV writer ───────────────────────────────────────────────────────────────

function buildWavBuffer(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.byteLength;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
