import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GithubConnectGuard extends AuthGuard('github-connect') {}
