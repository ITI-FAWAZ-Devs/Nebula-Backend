# Research: Agent RAG

## Decisions

| Topic | Decision | Rationale |
|---|---|---|
| LLM provider | Gemini function calling | Project already uses Gemini exclusively |
| Content contract | Chroma file descriptions | Graph nodes lack bodies; clones are ephemeral |
| lineRange | Normalize `sourceLocation` | Avoid Graphify schema change |
| Rationale tools | Out of scope | Label does not exist in Neo4j |
| Reranker | Gemini 0–1 batch JSON scores | Cheap enough for v1; skip cross-encoder |
| Coexistence | New module; keep HybridRetriever + /ask | Avoid breaking architecture drafting |
| Sessions | Redis JSON, last 5 turns | Already have Redis for BullMQ |
| Streaming | SSE final answer only | Bound latency; hide tool chatter |
