/**
 * Graphify CLI `graph.json` shape (from `graphify extract`).
 */
export interface GraphifyResult {
  raw: unknown;
  nodes?: GraphifyNode[];
  edges?: GraphifyEdge[];
  outputPath?: string;
}

export interface GraphifyNode {
  id: string;
  type?: string;
  label?: string;
  name?: string;
  path?: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  metadata?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface GraphifyEdge {
  id?: string;
  type?: string;
  label?: string;
  /** Graphify uses `relation` (e.g. contains, method, imports, calls). */
  relation?: string;
  source: string;
  target: string;
  confidence?: string;
  source_file?: string;
  properties?: Record<string, unknown>;
}
