import { z } from "zod";
const evidenceNote=z.string().min(1).max(220);
export const enrichmentSchema = z.object({
  status: z.enum(["confident", "uncertain", "conflicting"]), confidence: z.number().min(0).max(1), genres: z.array(z.string()).min(1).max(2),
  styles: z.array(z.string()).min(1).max(3), moods: z.array(z.string()).min(1).max(3), scenes: z.array(z.string()).max(2),
  artistDescription: z.string().max(500), albumDescription: z.string().max(500),
  proposedTerms: z.array(z.object({ kind: z.enum(["genre", "style", "mood", "scene"]), name: z.string() })).max(8), evidenceNotes: z.array(evidenceNote).max(8),
});
export const enrichmentJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["status", "confidence", "genres", "styles", "moods", "scenes", "artistDescription", "albumDescription", "proposedTerms", "evidenceNotes"],
  properties: {
    status: { type: "string", enum: ["confident", "uncertain", "conflicting"] }, confidence: { type: "number", minimum: 0, maximum: 1 },
    genres: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 }, styles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    moods: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, scenes: { type: "array", items: { type: "string" }, maxItems: 2 },
    artistDescription: { type: "string", maxLength: 500 }, albumDescription: { type: "string", maxLength: 500 },
    proposedTerms: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["kind", "name"], properties: { kind: { type: "string", enum: ["genre", "style", "mood", "scene"] }, name: { type: "string" } } } },
    evidenceNotes: { type: "array", items: { type: "string", minLength: 1, maxLength: 220 }, maxItems: 8 },
  },
} as const;
