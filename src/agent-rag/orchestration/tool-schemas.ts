import { FunctionDeclarationsTool, SchemaType } from '@google/generative-ai';

/**
 * Frozen tool schemas for the planner. Cypher is never authored by the LLM —
 * these declarations only select which parameterized Neo4j/Chroma call to run.
 */
export const AGENT_TOOL_DECLARATIONS: FunctionDeclarationsTool[] = [
  {
    functionDeclarations: [
      {
        name: 'vector_search',
        description:
          'Semantic search over indexed file descriptions for the repository. Use for conceptual questions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: 'Search query' },
            k: { type: SchemaType.NUMBER, description: 'Top-k results (1-20)' },
            filePath: {
              type: SchemaType.STRING,
              description: 'Optional metadata filter: exact file path',
            },
            language: {
              type: SchemaType.STRING,
              description: 'Optional metadata filter: language',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'getDefinition',
        description:
          'Resolve a single graph node by nodeId, or by name and optional type.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            nodeId: { type: SchemaType.STRING },
            name: { type: SchemaType.STRING },
            type: {
              type: SchemaType.STRING,
              description:
                'Entity type: Class, Method, Function, Interface, File, Directory, Repository',
            },
          },
        },
      },
      {
        name: 'getCallers',
        description: 'Find nodes that CALL the given node.',
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
        description: 'Find nodes that the given node CALLS.',
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
          'Find IMPLEMENTS/EXTENDS neighbors of the given node (both directions).',
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
          'Get symbols and children contained in a file (CONTAINS / HAS_METHOD).',
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
          'Ego neighborhood of a directory/file over CONTAINS|IMPORTS|DEPENDS_ON (max 2 hops).',
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
          'Vector search followed by graph expansion and reranking. Good default for open-ended questions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING },
            k: { type: SchemaType.NUMBER },
          },
          required: ['query'],
        },
      },
    ],
  },
];
