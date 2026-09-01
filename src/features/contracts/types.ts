export type EvidenceFact<T = unknown> = { provider: string; sourceId: string; retrievedAt: string; value: T };
export type ResolvedIdentity = { artistId?: string; releaseGroupId?: string; artist: string; album: string; date?: string; confidence: number; margin: number; evidence: string[]; semanticTags?: string[] };
export type TaxonomyKind = "genre" | "style" | "mood" | "scene";
export type EnrichmentDecision = {
  status: "confident" | "uncertain" | "conflicting"; confidence: number; genres: string[]; styles: string[]; moods: string[]; scenes: string[];
  artistDescription: string; albumDescription: string; proposedTerms: Array<{ kind: TaxonomyKind; name: string }>; evidenceNotes: string[];
};
export type DesiredTrackMetadata = { properties: Record<string, string[]>; coverPath?: string };
export type LibraryIssue = { fileId?: number; albumKey?: string; code: string; severity: "info" | "warning" | "error"; message: string };
export type ProcessingJob = { id: number; phase: "scan" | "analyze" | "resolve" | "collect" | "enrich" | "categorize" | "write" | "notify"; status: "queued" | "running" | "complete" | "failed" };
