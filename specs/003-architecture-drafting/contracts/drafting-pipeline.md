# Internal Contract: Architecture Drafting Pipeline

## Consumer

The contract is internal to the backend. Phase 3's persistence layer, controller, and BullMQ job processor are its first consumers. This phase exposes no HTTP endpoint.

## Service Operation

```text
draft(repositoryId) -> Promise<ArchitectureDraft>
```

| Input | Contract |
|---|---|
| `repositoryId` | Required existing repository identifier. Must reference a repository with status `READY` (completed indexing). Used to scope every retrieval call. |

## Pipeline Stages

The drafting pipeline executes four sequential stages. Each stage is owned by a dedicated service.

### Stage 1: Structure Planning (`StructurePlannerService`)

```text
plan(repositoryId) -> Promise<SectionPlan[]>
```

- Performs one broad `HybridRetrieverService.retrieve` call with topic "architecture overview of the repository".
- Reads repository metadata (name, owner) from Prisma.
- Sends evidence + metadata to the LLM via the structure-plan prompt template.
- Parses the JSON response into `SectionPlan[]`.
- Validates: discards duplicate keys, entries with missing fields.
- Returns an empty array if no evidence is available (both sources empty).

### Stage 2: Section Generation (`SectionGeneratorService`)

```text
generate(repositoryId, plan: SectionPlan, context: HybridRetrievalContext) -> Promise<DraftSection>
```

- For each `SectionPlan`, performs a focused `HybridRetrieverService.retrieve` call using the section's `retrievalTopic`.
- Builds a prompt with the focused evidence and instructs the LLM to:
  - Write only claims supported by the provided file evidence.
  - Cite repository file paths inline for every non-trivial claim.
  - Not invent or hallucinate file paths.
- Parses the response into a `DraftSection` with `verdict: 'unverified'` (pre-verification).

### Stage 3: Section Verification (`SectionVerifierService`)

```text
verify(section: DraftSection, context: HybridRetrievalContext) -> Promise<DraftSection>
```

- For each `DraftSection`, builds a verification prompt with the section body, cited files, and the same evidence context used in Stage 2.
- The verifier independently checks:
  - Every material claim has supporting evidence from the context.
  - Every cited file path exists in the provided context's file list.
- Returns one of:
  - The section with `verdict: 'verified'` if all checks pass.
  - A rewritten section with unsupported claims removed and `verdict: 'verified'`.
  - The section with `verdict: 'unverified'` and `verificationNotes` explaining the issue.
- **One follow-up retrieval** is allowed per section: if the verifier identifies a specific claim that might be resolved with narrower evidence, it may call `HybridRetrieverService.retrieve` with a more focused topic. Only one such follow-up is permitted per section.

### Stage 4: Diagram Generation (`DiagramGeneratorService`)

```text
generate(relationships: FileRelationship[], clusters: ModuleCluster[], sections: DraftSection[]) -> Promise<ArchitectureDiagram | null>
```

- Receives the `relationships` and `moduleClusters` collected from Stage 2 retrieval results.
- Sends the evidence to the LLM via the diagram prompt template.
- Instructs the LLM to generate Mermaid `flowchart TD` or `graph TD` syntax using only evidenced modules.
- Validates the output:
  - Must start with `flowchart` or `graph`.
  - Every node label must correspond to a module present in the evidence.
- Returns `null` with a verification note if:
  - No relationship evidence is available.
  - The generated Mermaid is malformed.
  - The diagram includes a module not present in the evidence.

## Result Guarantees

- Every returned `DraftSection.sourceFiles` entry is a file path that appeared in the retrieval evidence for that section.
- Every section with `verdict: 'verified'` has all material claims supported by evidence.
- Sections with `verdict: 'unverified'` include `verificationNotes` explaining which claims lack support.
- The `sectionPlan` in the result exactly matches the plan used for generation.
- `sourceStatus` reflects the retrieval availability from the broad planning retrieval.
- The `diagram`, when present, contains only modules evidenced by the retrieved relationship data.
- The `sections` array preserves the order of the `sectionPlan`.

## Failure Semantics

| Condition | Result |
|---|---|
| Repository does not exist | Fail as not found. |
| Repository not indexed (status ≠ READY) | Fail with a clear error before any LLM calls. |
| Broad retrieval returns no evidence (both sources empty/unavailable) | Return an `ArchitectureDraft` with empty `sections`, no `diagram`, and a diagnostic note. |
| A section's focused retrieval returns no evidence | Generate the section with minimal content and mark it `unverified`. |
| LLM returns malformed JSON for section plan | Retry once; if still malformed, fail the planning stage. |
| LLM returns malformed section content | Skip the section; include it as `verdict: 'removed'` with error notes. |
| Verification identifies unsupported claims | Rewrite or mark unverified per the verifier's assessment. |
| Diagram evidence is insufficient or malformed | Return the draft without a diagram; include a note in the result. |
| Both retrieval sources unavailable | Propagate the `HybridRetrieverService` error; the pipeline cannot proceed. |

## Privacy Boundary

The service does not accept a user identity because it is an internal dependency. It operates on a `repositoryId` and delegates all retrieval scoping to `HybridRetrieverService`, which enforces repository isolation. Any future controller or job must verify repository ownership before invoking the drafting service.
