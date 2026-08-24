import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import {
  checkExecutable,
  checkFileExists,
  spawnCrossPlatform,
} from './cross-platform-spawn.util';

/**
 * Validates that the whisper.cpp and Piper binaries + model files
 * are present and executable when the voice module boots.
 *
 * If VOICE_ENABLED=false, skips all checks silently.
 * If a binary or model is missing the service logs a clear actionable
 * error pointing to docs/voice-setup.md but does NOT crash the server —
 * the voice gateway will return an error event when a client tries to
 * start a session.
 */
@Injectable()
export class VoiceModelCheckService implements OnModuleInit {
  private readonly logger = new Logger(VoiceModelCheckService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<boolean>('voice.enabled');
    if (!enabled) {
      this.logger.log('Voice is disabled (VOICE_ENABLED=false). Skipping model check.');
      return;
    }

    const whisperBin = this.config.get<string>('voice.whisperBin')!;
    const whisperModel = this.config.get<string>('voice.whisperModel')!;
    const piperBin = this.config.get<string>('voice.piperBin')!;
    const piperModel = this.config.get<string>('voice.piperModel')!;

    const issues: string[] = [];

    // ── whisper.cpp binary ──────────────────────────────────────────────────
    if (!checkExecutable(whisperBin)) {
      issues.push(
        `whisper.cpp binary not found or not executable: "${whisperBin}"\n` +
        `  Set VOICE_WHISPER_BIN to the full path of the built 'main' or 'whisper-cpp' binary.\n` +
        `  See docs/voice-setup.md § 1.`,
      );
    } else {
      this.logger.log(`whisper.cpp binary OK: ${whisperBin}`);
    }

    // ── whisper model file ──────────────────────────────────────────────────
    if (!checkFileExists(whisperModel)) {
      issues.push(
        `whisper.cpp model not found: "${whisperModel}"\n` +
        `  Download via: bash models/download-ggml-model.sh base.en\n` +
        `  Then set VOICE_WHISPER_MODEL to its absolute path.\n` +
        `  See docs/voice-setup.md § 1.`,
      );
    } else {
      this.logger.log(`whisper.cpp model OK: ${path.basename(whisperModel)}`);
    }

    // ── Piper binary ────────────────────────────────────────────────────────
    if (!checkExecutable(piperBin)) {
      issues.push(
        `Piper binary not found or not executable: "${piperBin}"\n` +
        `  Download from https://github.com/rhasspy/piper/releases\n` +
        `  Then set VOICE_PIPER_BIN to its absolute path.\n` +
        `  See docs/voice-setup.md § 2.`,
      );
    } else {
      this.logger.log(`Piper binary OK: ${piperBin}`);
    }

    // ── Piper ONNX model ────────────────────────────────────────────────────
    if (!checkFileExists(piperModel)) {
      issues.push(
        `Piper model not found: "${piperModel}"\n` +
        `  Download an ONNX voice from https://huggingface.co/rhasspy/piper-voices\n` +
        `  Then set VOICE_PIPER_MODEL to its absolute path.\n` +
        `  See docs/voice-setup.md § 2.`,
      );
    } else {
      this.logger.log(`Piper model OK: ${path.basename(piperModel)}`);
    }

    // ── Also check the .onnx.json config exists next to the model ──────────
    const piperModelJson = piperModel + '.json';
    if (checkFileExists(piperModel) && !checkFileExists(piperModelJson)) {
      issues.push(
        `Piper model config not found: "${piperModelJson}"\n` +
        `  Download the matching .onnx.json alongside the .onnx file.\n` +
        `  See docs/voice-setup.md § 2.`,
      );
    }

    if (issues.length > 0) {
      this.logger.error(
        '╔═══════════════════════════════════════════════════╗\n' +
        '║  VOICE AGENT: missing binaries or model files     ║\n' +
        '╚═══════════════════════════════════════════════════╝\n\n' +
        issues.join('\n\n') +
        '\n\nVoice sessions will fail until these issues are resolved.' +
        '\nFull setup guide: docs/voice-setup.md',
      );
    } else {
      this.logger.log('Voice model check passed — whisper.cpp + Piper ready.');
    }

    // Perform a quick smoke-test of the whisper binary (--help)
    if (checkExecutable(whisperBin)) {
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawnCrossPlatform(whisperBin, ['-h'], { stdio: 'ignore' });
          const timer = setTimeout(() => {
            proc.kill();
            resolve();
          }, 3000);
          proc.on('close', () => {
            clearTimeout(timer);
            resolve();
          });
          proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      } catch (err: unknown) {
        this.logger.warn(`whisper.cpp smoke-test warning: ${(err as Error).message}`);
      }
    }
  }
}

