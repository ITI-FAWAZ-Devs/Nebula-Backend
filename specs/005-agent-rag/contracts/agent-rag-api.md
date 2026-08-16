# Contract: Agent RAG API

Base: `/api/repositories/:repositoryId/agent`  
Auth: JWT (cookie or Bearer). Ownership required.

## POST `/sessions`

Creates a session.

**Response `data`:**
```json
{ "sessionId": "uuid", "repositoryId": "uuid" }
```

## GET `/sessions/:sessionId`

**Response `data`:**
```json
{ "sessionId": "uuid", "repositoryId": "uuid", "turnCount": 2, "updatedAt": "ISO" }
```

## POST `/sessions/:sessionId/messages`

Body:
```json
{ "question": "string", "mode": "standard | fast | deep", "model": "optional-model-id" }
```

**Content-Type:** `text/event-stream`

| Event | Data |
|---|---|
| `mode` | `"fast"` \| `"standard"` \| `"deep"` |
| `progress` | `{ step, total, subQuestion }` — deep mode only |
| `scanning` | `{ filePath, tool }` — emitted as retrieval finds files, before tokens |
| `web_source` | `{ title, url, snippet, score }` — Tavily results, if `web_search` ran |
| `citation` | `{ filePath, lineRange, nodeId, snippet? }` |
| `token` | string chunk of the synthesizer answer |
| `done` | `{ answer, citations, citedNodeIds, toolsUsed, followups? }` |
| `followups` | `string[]` |
| `error` | `{ message }` |

Retrieval runs server-side. The stream first emits `scanning` (and optional `web_source`) events, then structured `citation` payloads with optional source snippets, then synthesizer `token`s.
