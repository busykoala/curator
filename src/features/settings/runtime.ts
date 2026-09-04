import { config } from "@/config";
import { stateGet, stateSet } from "@/features/db/client";

export type RuntimeSettings = {
  scanIntervalHours: number;
  enrichmentBatchAlbums: number;
  categorizationBatchAlbums: number;
  libraryPageSize: number;
  stackRefreshSeconds: number;
  navidromeUsername: string;
  acquisitionAutomation: boolean;
  qualityFallback: boolean;
  bulkMigrationThreshold: number;
  completionIncompleteThreshold: number;
  activeDownloadMin: number;
  activeDownloadMax: number;
  seedRatio: number;
  seedDays: number;
};

const defaults: RuntimeSettings = {
  scanIntervalHours: 24,
  enrichmentBatchAlbums: 8,
  categorizationBatchAlbums: 16,
  libraryPageSize: 48,
  stackRefreshSeconds: 15,
  navidromeUsername: "",
  acquisitionAutomation: true,
  qualityFallback: true,
  bulkMigrationThreshold: 25,
  completionIncompleteThreshold: 20,
  activeDownloadMin: 12,
  activeDownloadMax: 48,
  seedRatio: 1,
  seedDays: 14,
};

const ranges: Partial<Record<keyof RuntimeSettings, [number, number]>> = {
  scanIntervalHours: [1, 168],
  enrichmentBatchAlbums: [1, 24],
  categorizationBatchAlbums: [1, 64],
  libraryPageSize: [12, 120],
  stackRefreshSeconds: [5, 120],
  bulkMigrationThreshold: [5, 200],
  completionIncompleteThreshold: [2, 100],
  activeDownloadMin: [4, 48],
  activeDownloadMax: [12, 96],
  seedRatio: [0.1, 10],
  seedDays: [1, 60],
};

export function runtimeSettings(): RuntimeSettings {
  const saved = stateGet("runtime_settings");
  if (!saved) return defaults;
  try { return { ...defaults, ...JSON.parse(saved) as Partial<RuntimeSettings> }; }
  catch { return defaults; }
}

export function updateRuntimeSettings(input: Record<string, unknown>): RuntimeSettings {
  const next = { ...runtimeSettings() };
  for (const [key, range] of Object.entries(ranges)) {
    const [minimum, maximum] = range!;
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
    (next as unknown as Record<string, number>)[key] = Math.min(maximum, Math.max(minimum, Math.round(value)));
  }
  if (input.acquisitionAutomation !== undefined) next.acquisitionAutomation = Boolean(input.acquisitionAutomation);
  if (input.qualityFallback !== undefined) next.qualityFallback = Boolean(input.qualityFallback);
  if (next.activeDownloadMax < next.activeDownloadMin) next.activeDownloadMax = next.activeDownloadMin;
  if (input.navidromeUsername !== undefined) next.navidromeUsername = String(input.navidromeUsername).trim().slice(0, 120);
  if (typeof input.navidromePassword === "string" && input.navidromePassword) stateSet("navidrome_password", input.navidromePassword);
  if (input.clearNavidromePassword === true) stateSet("navidrome_password", "");
  stateSet("runtime_settings", JSON.stringify(next));
  return next;
}

export function publicRuntimeSettings() {
  return {
    ...runtimeSettings(),
    navidromePasswordConfigured: Boolean(stateGet("navidrome_password")),
    lunaModel: config.OPENAI_MODEL || config.OPENAI_LUNA_MODEL,
    terraModel: config.OPENAI_MODEL || config.OPENAI_TERRA_MODEL,
    musicRoot: config.MUSIC_ROOT,
  };
}

export function navidromePassword(): string { return stateGet("navidrome_password"); }
