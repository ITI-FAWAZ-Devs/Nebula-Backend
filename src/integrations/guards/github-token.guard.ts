import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';
import { GithubTokenService } from '../github-token.service';

@Injectable()
export class GithubTokenGuard implements CanActivate {
  constructor(private readonly githubTokenService: GithubTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      return false;
    }

    const hasToken = await this.githubTokenService.hasValidToken(userId);

    if (!hasToken) {
      throw new HttpException(
        {
          success: false,
          statusCode: 428,
          errorCode: 'GITHUB_TOKEN_REQUIRED',
          message:
            'A GitHub Personal Access Token is required before accessing repository features. Please save a PAT via POST /api/integrations/github/token.',
        },
        428,
      );
    }

    return true;
  }
}
