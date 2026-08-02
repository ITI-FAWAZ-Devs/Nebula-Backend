import { applyDecorators, UseGuards } from '@nestjs/common';
import { GithubTokenGuard } from '../guards/github-token.guard';

/**
 * Decorator that ensures the calling user has a stored GitHub PAT
 * before the route handler executes. Returns 428 if missing.
 */
export function RequireGithubToken() {
  return applyDecorators(UseGuards(GithubTokenGuard));
}
