import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GithubTokenService } from './github-token.service';
import { SaveGithubTokenDto } from './dto/save-github-token.dto';

@Controller('integrations/github/token')
export class GithubTokenController {
  constructor(private readonly githubTokenService: GithubTokenService) {}

  /**
   * POST /integrations/github/token
   * Accepts a PAT, validates it with GitHub, checks for repo scope,
   * encrypts and stores it. Never returns the token itself.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async saveToken(
    @CurrentUser('id') userId: string,
    @Body() dto: SaveGithubTokenDto,
  ) {
    const result = await this.githubTokenService.validateAndSave(
      userId,
      dto.token,
    );
    return {
      success: true,
      message: 'GitHub token saved successfully',
      data: result,
    };
  }

  /**
   * GET /integrations/github/token/status
   * Returns whether a valid token exists, without exposing it.
   */
  @Get('status')
  async getTokenStatus(@CurrentUser('id') userId: string) {
    const status = await this.githubTokenService.getStatus(userId);
    return {
      success: true,
      data: status,
    };
  }

  /**
   * DELETE /integrations/github/token
   * Removes the stored GitHub token.
   */
  @Delete()
  async removeToken(@CurrentUser('id') userId: string) {
    await this.githubTokenService.remove(userId);
    return {
      success: true,
      message: 'GitHub token removed successfully',
    };
  }
}
