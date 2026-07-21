import { registerAs } from '@nestjs/config';

export default registerAs('graphify', () => ({
  bin: process.env.GRAPHIFY_BIN || 'graphify',
  args: process.env.GRAPHIFY_ARGS || '',
  timeoutMs: parseInt(process.env.GRAPHIFY_TIMEOUT_MS || '300000', 10),
}));
