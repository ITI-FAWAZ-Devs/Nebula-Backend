import { registerAs } from '@nestjs/config';

export default registerAs('documentation', () => ({
  describeConcurrency: parseInt(
    process.env.DOCUMENTATION_DESCRIBE_CONCURRENCY || '4',
    10,
  ),
  describeDelayMs: parseInt(
    process.env.DOCUMENTATION_DESCRIBE_DELAY_MS || '0',
    10,
  ),
}));
