/**
 * Builds the prompt for describing a file's contents.
 */
export function buildFileDescriptionPrompt(
  filePath: string,
  content: string,
): string {
  return `You are a technical documentation AI. Analyze the following source file and generate a detailed documentation write-up.
File Path: ${filePath}

Source Code:
\`\`\`
${content}
\`\`\`

Generate a documentation-style write-up containing:
1. The file's overall purpose.
2. Each exported function, class, interface, type, or variable, with a short description and its estimated line range (e.g., lines 12-45).
3. Key imports or dependencies of the file.
4. Anything a developer should know before touching or modifying this file (e.g., constraints, side-effects, gotchas).

Keep your response structured, concise, and professional.`;
}

/**
 * Builds the prompt for answering a user question given code documentation context.
 */
export function buildAnswerQuestionPrompt(
  question: string,
  context: string,
): string {
  return `You are an expert AI assistant answering questions about a codebase.
Use the following block of retrieved code documentation as context to answer the user's question.

Retrieved Documentation Context:
---
${context}
---

User's Question:
${question}

Instructions:
1. Produce a direct, helpful, and technically accurate answer grounded ONLY in the retrieved documentation context above.
2. Cite the file paths of the relevant files in your answer.
3. If the context does not contain enough information to answer the question, clearly state that the context doesn't contain the answer (do not make things up).`;
}
