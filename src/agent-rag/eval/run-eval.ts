/**
 * Eval harness for Agent RAG.
 *
 * Usage:
 *   EVAL_REPOSITORY_ID=<uuid> npx ts-node -r tsconfig-paths/register src/agent-rag/eval/run-eval.ts
 *
 * Requires a bootstrapped Nest app context with Gemini/Chroma/Neo4j configured.
 * Scores each fixture with simple contains + optional citation checks.
 */
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AgentLoopService } from '../orchestration/agent-loop.service';

interface EvalCase {
  id: string;
  intent: string;
  question: string;
  expectedAnswerContains: string[];
  mustCiteFile?: boolean;
}

async function main() {
  const repositoryId = process.env.EVAL_REPOSITORY_ID;
  if (!repositoryId) {
    console.error('EVAL_REPOSITORY_ID is required');
    process.exit(1);
  }

  const fixturePath = path.join(__dirname, 'fixtures', 'default-repo.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as EvalCase[];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const loop = app.get(AgentLoopService);

  let passed = 0;
  for (const c of cases) {
    try {
      const result = await loop.run({
        repositoryId,
        question: c.question,
      });
      const answerLower = result.answer.toLowerCase();
      const containsOk = c.expectedAnswerContains.some((needle) =>
        answerLower.includes(needle.toLowerCase()),
      );
      const citeOk = !c.mustCiteFile || result.citations.length > 0;
      const ok = containsOk && citeOk;
      if (ok) passed += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${c.id} [${c.intent}] contains=${containsOk} citations=${citeOk}`,
      );
    } catch (error) {
      console.log(`FAIL ${c.id} error=${(error as Error).message}`);
    }
  }

  console.log(`\nScore: ${passed}/${cases.length}`);
  await app.close();
  process.exit(passed === cases.length ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
