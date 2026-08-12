import { Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { TTSProvider } from './tts-provider.interface';

/**
 * PiperTTSProvider
 *
 * Per-session instance. Pipes text into the Piper CLI with `--output-raw`
 * and streams raw PCM chunks (16 kHz, mono, 16-bit) to the registered audio
 * callback. The gateway wraps them in WAV headers or forwards them as-is
 * depending on client capability.
 *
 * `stop()` kills the running piper process immediately so barge-in is instant.
 */
export class PiperTTSProvider implements TTSProvider {
  private readonly logger = new Logger(PiperTTSProvider.name);

  private audioCallback: ((chunk: Buffer) => void) | null = null;
  private currentProcess: ChildProcess | null = null;
  private speaking = false;

  constructor(
    private readonly piperBin: string,
    private readonly piperModel: string,
  ) {}

  async speak(text: string): Promise<void> {
    if (this.speaking) {
      await this.stop();
    }

    const cleaned = text.trim();
    if (!cleaned) return;

    this.speaking = true;

    return new Promise<void>((resolve) => {
      const args = [
        '--model', this.piperModel,
        '--output-raw',
      ];

      const proc = spawn(this.piperBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.currentProcess = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        if (this.speaking) {
          this.audioCallback?.(chunk);
        }
      });

      proc.stderr.on('data', (d: Buffer) => {
        this.logger.verbose(`piper stderr: ${d.toString().trim()}`);
      });

      proc.on('close', (code) => {
        this.speaking = false;
        this.currentProcess = null;
        if (code !== 0 && code !== null) {
          this.logger.warn(`piper exited with code ${code}`);
        }
        resolve();
      });

      proc.on('error', (err) => {
        this.logger.error(`piper spawn error: ${err.message}`);
        this.speaking = false;
        this.currentProcess = null;
        resolve();
      });

      proc.stdin.write(cleaned + '\n');
      proc.stdin.end();
    });
  }

  async stop(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  onAudio(callback: (chunk: Buffer) => void): void {
    this.audioCallback = callback;
  }
}
