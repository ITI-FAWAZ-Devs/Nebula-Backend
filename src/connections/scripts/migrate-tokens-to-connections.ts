import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConnectionProvider, CredentialType } from '@prisma/client';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('Starting migration from user_github_tokens to connections...');

  try {
    await prisma.$connect();
    const legacyTokens = await prisma.userGithubToken.findMany();
    console.log(`Found ${legacyTokens.length} legacy GitHub tokens.`);

    for (const token of legacyTokens) {
      const existing = await prisma.connection.findFirst({
        where: { userId: token.userId, provider: ConnectionProvider.GITHUB },
      });

      let connectionId = existing?.id;

      if (!existing) {
        const created = await prisma.connection.create({
          data: {
            provider: ConnectionProvider.GITHUB,
            credentialType: CredentialType.PAT,
            label: 'Migrated GitHub PAT',
            encryptedToken: token.encryptedToken,
            scopes: token.scopes,
            lastValidatedAt: token.lastValidatedAt,
            isValid: true,
            userId: token.userId,
            createdByUserId: token.userId,
            createdAt: token.createdAt,
            updatedAt: token.updatedAt,
          },
        });
        connectionId = created.id;
        console.log(
          `Migrated token for user ${token.userId} -> connection ${connectionId}`,
        );
      }

      if (connectionId) {
        const updatedRepos = await prisma.repository.updateMany({
          where: { userId: token.userId, connectionId: null },
          data: {
            provider: ConnectionProvider.GITHUB,
            connectionId: connectionId,
          },
        });
        console.log(
          `Updated ${updatedRepos.count} repositories for user ${token.userId}`,
        );
      }
    }

    // Ensure all repositories have providerRepoId set from githubRepoId if missing
    const reposNeedingSync = await prisma.repository.findMany({
      where: { providerRepoId: null },
    });

    for (const repo of reposNeedingSync) {
      if (repo.githubRepoId) {
        await prisma.repository.update({
          where: { id: repo.id },
          data: {
            providerRepoId: repo.githubRepoId,
            provider: ConnectionProvider.GITHUB,
          },
        });
      }
    }

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
