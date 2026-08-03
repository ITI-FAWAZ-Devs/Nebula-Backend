import { registerAs } from '@nestjs/config';

export default registerAs('drafting', () => ({
  codeContextMaxFiles: parseInt(
    process.env.DRAFTING_CODE_CONTEXT_MAX_FILES || '12',
    10,
  ),
  codeContextMaxCharsPerFile: parseInt(
    process.env.DRAFTING_CODE_CONTEXT_MAX_CHARS_PER_FILE || '4000',
    10,
  ),
  codeContextMaxTotalChars: parseInt(
    process.env.DRAFTING_CODE_CONTEXT_MAX_TOTAL_CHARS || '32000',
    10,
  ),
}));
