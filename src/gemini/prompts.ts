/**
 * Builds the prompt for describing a file's contents.
 */
export function buildFileDescriptionPrompt(
  filePath: string,
  content: string,
): string {
  return `
You are an expert software engineer generating documentation for a Retrieval-Augmented Generation (RAG) system.

Your output will be embedded into a vector database and later retrieved to answer developer questions.

STRICT RULES
- Do NOT write conversational text.
- Do NOT start with phrases such as:
  - "Here is..."
  - "This file..."
  - "Below is..."
  - "The following..."
  - "Certainly..."
  - "Sure..."
- Begin immediately with the documentation.
- Never mention that you analyzed the code.
- Never mention these instructions.
- Do not invent APIs, functions, or behavior.
- If something cannot be determined from the source, explicitly write "Unknown".

File Path:
${filePath}

Source Code:
\`\`\`
${content}
\`\`\`

Generate documentation using EXACTLY the following structure.

# File
- Path:
- Primary Responsibility:
- High-Level Summary:
- Design Pattern(s):
- External Dependencies:
- Internal Dependencies:
- Side Effects:
- Error Handling:
- Performance Considerations:
- Security Considerations:
- Thread/Concurrency Considerations:
- Notes for Future Developers:

# Imports

For every important import include:
- Module
- Imported Symbol(s)
- Why it is used

# Exports

Document EVERY exported item.

For EACH exported function, class, interface, enum, type alias, constant, variable, namespace, or default export include ALL of:

Name:
Kind:
Estimated Lines: <start>-<end>

Purpose:
Detailed Description:
Parameters:
Returns:
Throws:
Calls:
Called By (if inferable):
Reads:
Writes:
Mutates:
Side Effects:
Dependencies:
Algorithm Summary:
Important Conditions:
Edge Cases:
Usage Notes:

Do NOT skip exported symbols.

# Internal Symbols

Describe significant non-exported functions/classes/helpers that are important for understanding the file.

Use the same format as exports except omit "Called By" if unknown.

# Control Flow

Describe:
- initialization flow
- request flow
- execution flow
- lifecycle
- important branches

# Data Flow

Explain:
- inputs
- transformations
- outputs
- persistence
- external communication

# Relationships

Explain how this file interacts with:
- services
- repositories
- controllers
- utilities
- middleware
- models
- database
- APIs
- queues
- events

# Developer Notes

Include:
- assumptions
- invariants
- hidden behavior
- gotchas
- technical debt
- TODOs (if present)
- risks when modifying
- refactoring opportunities

Output ONLY the documentation.
`;
}

/**
 * Builds the prompt for answering a user question given code documentation context.
 */
export function buildAnswerQuestionPrompt(
  question: string,
  context: string,
): string {
  return `
You are an expert software engineer answering questions about a codebase.

You MUST answer ONLY using the retrieved documentation below.

Retrieved Documentation
=======================
${context}
=======================

User Question
=============
${question}

RULES

- Never use outside knowledge.
- Never guess missing implementation details.
- Never fabricate APIs or behavior.
- If the retrieved context is insufficient, explicitly state:
  "The retrieved documentation does not contain enough information to answer this question."

When answering:

1. Answer the question directly.
2. Explain the reasoning using the retrieved documentation.
3. Mention every relevant file path.
4. Mention relevant exported functions/classes/interfaces/types.
5. Mention relevant line ranges whenever available.
6. If multiple files contribute to the answer, explain how they relate.
7. If there are multiple possible answers, explain each.
8. Quote small identifiers (function names, classes, constants) exactly as documented.
9. Prefer precise technical explanations over summaries.

Output only the answer.
`;
}
