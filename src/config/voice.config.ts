import { registerAs } from '@nestjs/config';

export default registerAs('voice', () => ({
  enabled: process.env.VOICE_ENABLED === 'true',
  whisperBin: process.env.VOICE_WHISPER_BIN || 'whisper-cpp',
  whisperModel: process.env.VOICE_WHISPER_MODEL || 'models/ggml-base.en.bin',
  piperBin: process.env.VOICE_PIPER_BIN || 'piper',
  piperModel:
    process.env.VOICE_PIPER_MODEL || 'models/en_US-lessac-medium.onnx',
  /** PCM sample rate whisper expects (16 kHz mono) */
  sampleRate: parseInt(process.env.VOICE_SAMPLE_RATE || '16000', 10),
  /** Silence duration in ms before committing an utterance */
  silenceDurationMs: parseInt(
    process.env.VOICE_SILENCE_DURATION_MS || '1200',
    10,
  ),
}));
