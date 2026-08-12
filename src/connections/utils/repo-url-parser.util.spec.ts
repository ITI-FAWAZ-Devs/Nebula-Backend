import { BadRequestException } from '@nestjs/common';
import { ConnectionProvider } from '@prisma/client';
import { parseRepoUrl } from './repo-url-parser.util';

describe('parseRepoUrl', () => {
  it('should parse full https github url', () => {
    const res = parseRepoUrl('https://github.com/facebook/react');
    expect(res).toEqual({
      provider: ConnectionProvider.GITHUB,
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('should parse url with trailing .git and slash', () => {
    const res = parseRepoUrl('https://github.com/vercel/next.js.git/');
    expect(res).toEqual({
      provider: ConnectionProvider.GITHUB,
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('should parse github.com domain without protocol', () => {
    const res = parseRepoUrl('github.com/expressjs/express');
    expect(res).toEqual({
      provider: ConnectionProvider.GITHUB,
      owner: 'expressjs',
      repo: 'express',
    });
  });

  it('should parse shorthand owner/repo', () => {
    const res = parseRepoUrl('nestjs/nest');
    expect(res).toEqual({
      provider: ConnectionProvider.GITHUB,
      owner: 'nestjs',
      repo: 'nest',
    });
  });

  it('should parse gitlab url', () => {
    const res = parseRepoUrl('https://gitlab.com/gitlab-org/gitlab');
    expect(res).toEqual({
      provider: ConnectionProvider.GITLAB,
      owner: 'gitlab-org',
      repo: 'gitlab',
    });
  });

  it('should parse bitbucket url', () => {
    const res = parseRepoUrl('https://bitbucket.org/atlassian/jira');
    expect(res).toEqual({
      provider: ConnectionProvider.BITBUCKET,
      owner: 'atlassian',
      repo: 'jira',
    });
  });

  it('should throw BadRequestException on invalid input', () => {
    expect(() => parseRepoUrl('')).toThrow(BadRequestException);
    expect(() => parseRepoUrl('singleword')).toThrow(BadRequestException);
    expect(() => parseRepoUrl('ftp://github.com/foo/bar')).toThrow(
      BadRequestException,
    );
  });
});
