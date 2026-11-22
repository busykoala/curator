import { db } from "@/features/db/client";
import { audioModelResults } from "@/features/audio-model/client";
import { familyOf } from "@/features/genres/style-map";
import { GENRE_DERIVATION_VERSION } from "@/features/genres/derive";

/** Per-track facts used to keep a playlist stylistically and sonically coherent. */
export type CoherenceFacts = { family: string; cluster: string; embedding?: Float32Array | null };
export type CoherencePlan = { family: string; cluster: string; allowedFamilies: Set<string>; centroid: Float32Array | null; offFamilyLimit: number; cosineMean: number; cosineSpread: number };

export function loadCoherenceFacts(fileIds: number[]): Map<number, CoherenceFacts> {
  const facts = new Map<number, CoherenceFacts>();
  const ids = [...new Set(fileIds)];
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    const rows = db().prepare(`SELECT file_id,family,cluster FROM genre_derivations WHERE derivation_version=? AND file_id IN (${chunk.map(() => "?").join(",")})`).all(GENRE_DERIVATION_VERSION, ...chunk) as Array<{ file_id: number; family: string; cluster: string }>;
    for (const row of rows) facts.set(row.file_id, { family: row.family, cluster: row.cluster });
  }
  for (const [fileId, result] of audioModelResults(ids)) {
    const fact = facts.get(fileId);
    if (fact) fact.embedding = result.embedding;
  }
  return facts;
}

export function cosine(a: Float32Array | null | undefined, b: Float32Array | null | undefined): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; left += a[index] * a[index]; right += b[index] * b[index]; }
  return left && right ? dot / Math.sqrt(left * right) : null;
}

function mean(vectors: Array<{ vector: Float32Array; weight: number }>): Float32Array | null {
  if (!vectors.length) return null;
  const output = new Float32Array(vectors[0].vector.length);
  let total = 0;
  for (const { vector, weight } of vectors) { if (vector.length !== output.length) continue; total += weight; for (let index = 0; index < vector.length; index++) output[index] += vector[index] * weight; }
  if (!total) return null;
  for (let index = 0; index < output.length; index++) output[index] /= total;
  return output;
}

/**
 * Find the playlist's musical centre: the family and listening cluster carrying the
 * most score among the strongest candidates, and the sound centroid of that cluster.
 * Families named by the playlist's own style lanes stay allowed alongside it.
 */
export function planCoherence(input: { ranked: Array<{ fileId: number; score: number }>; fixed: number[]; target: number; facts: Map<number, CoherenceFacts>; styleLanes: string[]; offFamilyShare: number }): CoherencePlan | null {
  const { ranked, fixed, target, facts } = input;
  const head = [...fixed.map(fileId => ({ fileId, score: 1e3 })), ...ranked.slice(0, Math.max(target * 3, 30))].filter(item => facts.has(item.fileId));
  if (head.length < Math.min(5, target)) return null;
  const familyMass = new Map<string, number>(), clusterMass = new Map<string, number>();
  for (const { fileId, score } of head) {
    const fact = facts.get(fileId)!, weight = Math.max(1, score);
    familyMass.set(fact.family, (familyMass.get(fact.family) ?? 0) + weight);
    clusterMass.set(fact.cluster, (clusterMass.get(fact.cluster) ?? 0) + weight);
  }
  const family = [...familyMass].sort((a, b) => b[1] - a[1])[0][0];
  const cluster = [...clusterMass].filter(([name]) => head.some(item => facts.get(item.fileId)!.cluster === name && facts.get(item.fileId)!.family === family)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? `${family}.main`;
  const allowedFamilies = new Set([family, ...input.styleLanes.map(lane => familyOf(lane)).filter((value): value is NonNullable<typeof value> => Boolean(value))]);
  const centroid = mean(head.filter(item => facts.get(item.fileId)!.cluster === cluster && facts.get(item.fileId)!.embedding).map(item => ({ vector: facts.get(item.fileId)!.embedding!, weight: Math.max(1, item.score) })));
  const similarities = ranked.slice(0, 300).map(item => cosine(facts.get(item.fileId)?.embedding, centroid)).filter((value): value is number => value != null);
  const cosineMean = similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0;
  const cosineSpread = similarities.length ? Math.sqrt(similarities.reduce((sum, value) => sum + (value - cosineMean) ** 2, 0) / similarities.length) || 1 : 1;
  return { family, cluster, allowedFamilies, centroid, offFamilyLimit: Math.floor(target * input.offFamilyShare), cosineMean, cosineSpread };
}

/** Extra selection score for fitting the centre: same cluster, same family, and sounding close to it. */
export function coherenceBonus(plan: CoherencePlan, fact: CoherenceFacts | undefined): number {
  if (!fact) return 0;
  const similarity = cosine(fact.embedding, plan.centroid);
  const sound = similarity == null ? 0 : Math.max(-2.5, Math.min(2.5, (similarity - plan.cosineMean) / plan.cosineSpread)) * 8;
  return (fact.cluster === plan.cluster ? 18 : 0) + (plan.allowedFamilies.has(fact.family) ? 8 : -12) + sound;
}

/** Cost of playing `next` right after `previous`: sound distance, cluster and decade changes. */
export function transitionCost(previous: { fact?: CoherenceFacts; year?: number | null }, next: { fact?: CoherenceFacts; year?: number | null }): number {
  const similarity = cosine(previous.fact?.embedding, next.fact?.embedding);
  const sound = similarity == null ? 6 : (1 - similarity) * 60;
  const cluster = previous.fact && next.fact && previous.fact.cluster !== next.fact.cluster ? (previous.fact.family !== next.fact.family ? 14 : 6) : 0;
  const decades = previous.year && next.year ? Math.min(4, Math.abs(Math.floor(previous.year / 10) - Math.floor(next.year / 10))) * 3 : 0;
  return sound + cluster + decades;
}

export type CoherenceEvaluation = { dominantFamilyShare: number; dominantClusterShare: number; meanNeighbourSimilarity: number | null; centre?: { family: string; cluster: string } };
export function evaluateCoherence(fileIds: number[], facts: Map<number, CoherenceFacts>, plan?: CoherencePlan | null): CoherenceEvaluation {
  const known = fileIds.map(id => facts.get(id)).filter((fact): fact is CoherenceFacts => Boolean(fact));
  const top = (values: string[]) => { const counts = new Map<string, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); return Math.max(0, ...counts.values()); };
  const pairs: number[] = [];
  for (let index = 1; index < fileIds.length; index++) { const value = cosine(facts.get(fileIds[index - 1])?.embedding, facts.get(fileIds[index])?.embedding); if (value != null) pairs.push(value); }
  return {
    dominantFamilyShare: known.length ? Math.round(top(known.map(fact => fact.family)) / known.length * 100) / 100 : 0,
    dominantClusterShare: known.length ? Math.round(top(known.map(fact => fact.cluster)) / known.length * 100) / 100 : 0,
    meanNeighbourSimilarity: pairs.length ? Math.round(pairs.reduce((sum, value) => sum + value, 0) / pairs.length * 1000) / 1000 : null,
    ...(plan ? { centre: { family: plan.family, cluster: plan.cluster } } : {}),
  };
}
