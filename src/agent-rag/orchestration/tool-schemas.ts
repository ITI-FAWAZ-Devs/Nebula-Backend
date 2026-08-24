import { FunctionDeclarationsTool, SchemaType } from '@google/generative-ai';

/**
 * Frozen tool schemas for the planner. Cypher is never authored by the LLM —
 * these declarations only select which parameterized Neo4j/Chroma call to run.
 *
 * Descriptions double as the planner's decision manual: each one states what
 * the tool searches, when to pick it, and what NOT to use it for.
 */
export const AGENT_TOOL_DECLARATIONS: FunctionDeclarationsTool[] = [
  {
    functionDeclarations: [
      {
        name: 'vector_search',
        description:
          'Semantic search across AI-generated descriptions of every file in this repository (one entry per file). Best when you know the topic area and want candidate files fast. Queries should be short keyword phrases ("websocket auth guard"), not full sentences. Supports optional exact-match metadata filters. For open-ended questions prefer hybrid_search; for structural lookups (callers/implementations) use graph tools instead.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: {
              type: SchemaType.STRING,
              description:
                'Short semantic search phrase (3-8 words), e.g. "rate limiting middleware"',
            },
            k: {
              type: SchemaType.NUMBER,
              description: 'Top-k results. Default 10, maximum 20.',
            },
            filePath: {
              type: SchemaType.STRING,
              description:
                'Optional exact file path filter, e.g. "src/auth/guard.ts". Use to scope search to one file.',
            },
            language: {
              type: SchemaType.STRING,
              description:
                'Optional exact language filter, e.g. "typescript", "python".',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'getDefinition',
        description:
          'Resolve ONE entity (Class, Method, Function, Interface, File, Directory) to its canonical graph node with file location. Use to turn a symbol name or a nodeId from earlier results into something you can traverse further. Call with either nodeId OR (name plus optional type). Do not use it for broad conceptual questions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nodeId: {
              type: SchemaType.STRING,
              description:
                'Exact graph nodeId, e.g. "repo-id:path/to/file.ts".',
            },
            name: {
              type: SchemaType.STRING,
              description: 'Symbol name, e.g. "AgentLoopService".',
            },
            type: {
              type: SchemaType.STRING,
              description:
                'Entity type hint when searching by name: Class, Method, Function, Interface, File, Directory, Repository.',
            },
          },
        },
      },
      {
        name: 'getCallers',
        description:
          'List entities that CALL the given node — answers "who uses/consumes/invoke this?". Requires an exact nodeId (resolve names via getDefinition first). Answers impact-analysis questions like "what breaks if I change X?".',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nodeId: { type: SchemaType.STRING },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'getCallees',
        description:
          'List entities the given node CALLS — answers "what does this depend on / call internally?". Requires an exact nodeId (resolve names via getDefinition first).',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nodeId: { type: SchemaType.STRING },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'getImplementations',
        description:
          'Find IMPLEMENTS/EXTENDS neighbors of a node in both directions — answers "which classes implement this interface?" or "what interface does this class implement?". Requires an exact nodeId.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nodeId: { type: SchemaType.STRING },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'getFileContext',
        description:
          'List all symbols contained in one file (classes, methods, functions) with their locations — answers "what is inside file X?". Requires the exact filePath, which you can obtain from vector/hybrid search hits or the user. Use for inventory questions, not for cross-file relationships.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            filePath: { type: SchemaType.STRING },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'getModuleOverview',
        description:
          'Show how a directory or file connects to its surroundings via CONTAINS/IMPORTS/DEPENDS_ON edges up to 2 hops — answers "how does module X fit into the architecture?" and "which modules does X depend on?". Requires an exact filePath or directory path.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            filePath: { type: SchemaType.STRING },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'hybrid_search',
        description:
          'The strongest default for open-ended questions: semantic vector search expanded through the dependency graph, deduplicated, enriched with file descriptions, and reranked. Returns diverse, high-quality context in ONE call. Prefer it for "how does X work?", comparisons, and multi-concept questions. Skip it when a precise structural lookup (callers, implementations, file contents) directly answers the question.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: {
              type: SchemaType.STRING,
              description:
                'Concise query capturing the core concept, e.g. "authentication flow JWT validation".',
            },
            k: {
              type: SchemaType.NUMBER,
              description:
                'Number of vector seeds before expansion. Default 8.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'web_search',
        description:
          'Search the public internet (Tavily) for third-party library documentation, standards, or general engineering concepts. STRICTLY for knowledge outside this repository; repository facts MUST come from the other tools. Typical use: the question mentions a library/version whose behavior is needed to interpret repo code.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: {
              type: SchemaType.STRING,
              description:
                'Web search query, include library name and version when relevant.',
            },
            maxResults: {
              type: SchemaType.NUMBER,
              description: 'Results to fetch, 1-5. Default 4.',
            },
          },
          required: ['query'],
        },
      },
    ],
  },
];
