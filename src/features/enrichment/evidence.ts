import type { EvidenceFact } from "@/features/contracts/types";

const TAG_FIELDS = ["title","artist","artists","album","albumArtist","albumArtists","date","year","genre","genres","composer","label","track","trackNumber","totalTracks","discNumber","totalDiscs","isrc","musicbrainzArtistId","musicbrainzAlbumArtistId","musicbrainzAlbumId","musicbrainzReleaseGroupId","musicbrainzTrackId","style","mood","scene"] as const;

function bounded(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (depth >= 3) return "[omitted]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => bounded(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [key, bounded(item, depth + 1)]));
  return String(value).slice(0, 500);
}
function existingTags(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const tags = value as Record<string, unknown>;
  return Object.fromEntries(TAG_FIELDS.flatMap((key) => tags[key] == null ? [] : [[key, bounded(tags[key])]]));
}
export function boundedEvidence(facts: EvidenceFact[]): EvidenceFact[] {
  return facts.slice(0, 8).map((fact) => ({ provider: fact.provider.slice(0, 40), sourceId: fact.sourceId.slice(0, 200), retrievedAt: fact.retrievedAt, value: fact.provider === "existing-tags" ? existingTags(fact.value) : bounded(fact.value) }));
}
