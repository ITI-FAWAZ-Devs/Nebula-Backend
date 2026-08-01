# Quickstart: Agent RAG

1. Ensure Redis, Neo4j, Chroma, and Gemini env vars are set.
2. Index a repository (analyze + document) so Neo4j graph and `repo-{id}` Chroma collection exist.
3. Start the API: `npm run dev`
4. Create a session:
   ```bash
   curl -X POST "$API/api/repositories/$REPO_ID/agent/sessions" -H "Authorization: Bearer $TOKEN"
   ```
5. Stream a message:
   ```bash
   curl -N -X POST "$API/api/repositories/$REPO_ID/agent/sessions/$SESSION_ID/messages" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"question":"How does authentication work?"}'
   ```
6. Run eval (optional):
   ```bash
   EVAL_REPOSITORY_ID=$REPO_ID npx ts-node -r tsconfig-paths/register src/agent-rag/eval/run-eval.ts
   ```
