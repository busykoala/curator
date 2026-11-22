import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
import { fingerprint } from "@/features/categorization/audio";

export const AUDIO_MODEL_VERSION = "discogs-effnet-bs64-1+heads-1";

export type AudioModelResponse = {
  modelVersion: string;
  analyzedSeconds: number;
  styles: Array<{ label: string; p: number }>;
  voice: number | null;
  danceable: number | null;
  moods: Record<string, number | null>;
  instruments: Array<{ label: string; p: number }>;
  embedding: string;
  dimensions: number;
};

export type AudioModelResult = {
  fileId: number;
  styles: Array<{ label: string; p: number }>;
  voice: number | null;
  danceable: number | null;
  moods: Record<string, number | null>;
  instruments: Array<{ label: string; p: number }>;
  embedding: Float32Array | null;
};

export function analyzerConfigured() {
  return Boolean(config.CURATOR_AUDIO_ANALYZER_URL);
}

export async function requestAnalysis(path: string, timeoutMs = 300_000): Promise<AudioModelResponse> {
  const response = await fetch(`${config.CURATOR_AUDIO_ANALYZER_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => ({}))) as AudioModelResponse & { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error ?? `Analyzer returned ${response.status}`), { status: response.status });
  return body;
}

export function decodeEmbedding(value: string | Buffer | null | undefined): Float32Array | null {
  if (!value) return null;
  const bytes = typeof value === "string" ? Buffer.from(value, "base64") : value;
  if (bytes.byteLength % 4) return null;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

type Row = { file_id: number; styles_json: string; heads_json: string; embedding: Buffer | null };
function toResult(row: Row): AudioModelResult {
  const heads = JSON.parse(row.heads_json || "{}") as Partial<AudioModelResult>;
  return {
    fileId: row.file_id,
    styles: JSON.parse(row.styles_json || "[]"),
    voice: heads.voice ?? null,
    danceable: heads.danceable ?? null,
    moods: heads.moods ?? {},
    instruments: heads.instruments ?? [],
    embedding: decodeEmbedding(row.embedding),
  };
}

/** Current results for these files (missing or failed analyses are omitted). */
export function audioModelResults(fileIds: number[]): Map<number, AudioModelResult> {
  const output = new Map<number, AudioModelResult>();
  for (let index = 0; index < fileIds.length; index += 500) {
    const ids = fileIds.slice(index, index + 500);
    if (!ids.length) continue;
    const rows = db()
      .prepare(`SELECT file_id,styles_json,heads_json,embedding FROM audio_model_results WHERE error IS NULL AND model_version=? AND file_id IN (${ids.map(() => "?").join(",")})`)
      .all(AUDIO_MODEL_VERSION, ...ids) as Row[];
    for (const row of rows) output.set(row.file_id, toResult(row));
  }
  return output;
}

type Pending = { id: number; path: string; format: string; size: number; known: string | null };
function pendingFiles(limit: number): Pending[] {
  // New and changed audio first (recent imports), then the rest of the library.
  return db()
    .prepare(`SELECT f.id,f.path,f.format,f.size,af.audio_fingerprint known FROM files f
      LEFT JOIN audio_features af ON af.file_id=f.id
      LEFT JOIN audio_model_results r ON r.file_id=f.id
      WHERE f.status IN ('analyzed','written') AND (
        r.file_id IS NULL OR r.model_version<>? OR (af.audio_fingerprint IS NOT NULL AND r.audio_fingerprint<>af.audio_fingerprint)
        OR (r.error IS NOT NULL AND r.attempts<5 AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=datetime('now'))))
      ORDER BY (r.file_id IS NULL) DESC, f.id DESC LIMIT ?`)
    .all(AUDIO_MODEL_VERSION, limit) as Pending[];
}

async function analyzeOne(file: Pending) {
  const audioFingerprint = file.known ?? (await fingerprint({ path: file.path, format: file.format, size: file.size } as Parameters<typeof fingerprint>[0]).catch(() => `unknown:${file.size}`));
  try {
    const result = await requestAnalysis(file.path);
    const embedding = Buffer.from(result.embedding, "base64");
    db().prepare(`INSERT INTO audio_model_results(file_id,audio_fingerprint,model_version,styles_json,heads_json,embedding,dimensions,analyzed_seconds,error,attempts,next_attempt_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,NULL,0,NULL,CURRENT_TIMESTAMP) ON CONFLICT(file_id) DO UPDATE SET audio_fingerprint=excluded.audio_fingerprint,model_version=excluded.model_version,
      styles_json=excluded.styles_json,heads_json=excluded.heads_json,embedding=excluded.embedding,dimensions=excluded.dimensions,analyzed_seconds=excluded.analyzed_seconds,
      error=NULL,attempts=0,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP`)
      .run(file.id, audioFingerprint, result.modelVersion, JSON.stringify(result.styles), JSON.stringify({ voice: result.voice, danceable: result.danceable, moods: result.moods, instruments: result.instruments }), embedding, result.dimensions, result.analyzedSeconds);
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    // Unreadable files (422) back off for a week; transient failures retry soon.
    const delay = status === 422 ? "+7 days" : "+30 minutes";
    db().prepare(`INSERT INTO audio_model_results(file_id,audio_fingerprint,model_version,error,attempts,next_attempt_at) VALUES (?,?,?,?,1,datetime('now',?))
      ON CONFLICT(file_id) DO UPDATE SET error=excluded.error,model_version=excluded.model_version,audio_fingerprint=excluded.audio_fingerprint,attempts=audio_model_results.attempts+1,next_attempt_at=excluded.next_attempt_at,updated_at=CURRENT_TIMESTAMP`)
      .run(file.id, audioFingerprint, AUDIO_MODEL_VERSION, String((error as Error).message ?? error).slice(0, 500), delay);
    return false;
  }
}

let running = false;
/**
 * Continuous background analysis: batches of 40 files, two at a time (the analyzer's
 * worker count), yielding whenever Curator is paused. Never blocks the main cycle.
 */
export function startAudioModelBackfill(): void {
  if (running || !analyzerConfigured()) return;
  running = true;
  const loop = async () => {
    try {
      while (stateGet("paused") !== "true" && stateGet("audio_model_paused") !== "true") {
        const batch = pendingFiles(40);
        if (!batch.length) break;
        let ok = 0, failed = 0, next = 0;
        const started = Date.now();
        await Promise.all(Array.from({ length: 2 }, async () => {
          for (;;) {
            const file = batch[next++];
            if (!file) return;
            if (await analyzeOne(file)) ok++;
            else failed++;
          }
        }));
        const remaining = (db().prepare(`SELECT count(*) n FROM files f LEFT JOIN audio_model_results r ON r.file_id=f.id AND r.model_version=? AND r.error IS NULL WHERE f.status IN ('analyzed','written') AND r.file_id IS NULL`).get(AUDIO_MODEL_VERSION) as { n: number }).n;
        stateSet("audio_model_progress", JSON.stringify({ ok, failed, remaining, secondsPerFile: Math.round(((Date.now() - started) / 1000 / Math.max(1, ok + failed)) * 10) / 10, at: new Date().toISOString() }));
        if (!ok && failed) break; // analyzer down: wait for the next scheduler cycle
      }
    } catch (error) {
      stateSet("audio_model_error", String(error));
    } finally {
      running = false;
    }
  };
  void loop();
}
