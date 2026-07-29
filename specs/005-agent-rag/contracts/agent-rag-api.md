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
{ "question": "string" }
```

**Content-Type:** `text/event-stream`

| Event | Data |
|---|---|
| `token` | string chunk |
| `citation` | `{ filePath, lineRange, nodeId }` |
| `done` | `{ answer, citations, citedNodeIds, toolsUsed }` |
| `error` | `{ message }` |

Planning and tool execution happen server-side before/during the stream setup; only synthesizer tokens are streamed.
