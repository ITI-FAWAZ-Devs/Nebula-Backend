# Data Model: Agent RAG

## RetrievalHit

| Field | Type | Notes |
|---|---|---|
| nodeId | string | Neo4j `id` or Chroma chunk id |
| type | EntityType \| 'Chunk' | |
| filePath | string \| null | coalesce(path, sourceFile, name) |
| lineRange | string \| null | from normalizeSourceLocation |
| content | string | description or graph summary |
| score | number | 0–1 |
| source | 'vector' \| 'graph' | |

## AgentSession (Redis)

Key: `agent-session:{sessionId}`  
TTL: 86400s  

```ts
{
  sessionId, repositoryId, userId,
  turns: [{ q, a, citedNodeIds }],
  updatedAt
}
```

## Tool cache (Redis)

Key: `agent-tool:{repositoryId}:{tool}:{argsHash}`  
TTL: 60s  
Value: JSON `RetrievalHit[]`
