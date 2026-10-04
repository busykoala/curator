import type {
  AcquisitionTarget,
  ControllerMode,
  DownloadObservation,
  InterventionDecision,
} from "./types";
const hour = 3_600_000;
const priorityWindow = 24 * hour;
export const searchLimits = {
  short: 10,
  daily: 150,
  recoveryShort: 30,
  recoveryDaily: 2_400,
  priorityDaily: 30,
} as const;
export const hoursSince = (value?: string | null) =>
  value
    ? Math.max(
        0,
        (Date.now() -
          new Date(
            value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
          ).getTime()) /
          hour,
      )
    : Infinity;
export function canConfirmImport(target: Pick<AcquisitionTarget, "status">) {
  return ["queued", "downloading", "downloaded"].includes(target.status);
}
export function controllerMode(
  migration: number,
  incomplete: number,
  stableHours: number,
  threshold = 25,
  incompleteThreshold = 20,
): ControllerMode {
  return migration <= threshold &&
    incomplete <= incompleteThreshold &&
    stableHours >= 24
    ? "completion"
    : "bulk";
}
export function searchBudget(counts: {
  short: number;
  daily: number;
  priorityDaily: number;
}, recovering = false) {
  const short = recovering ? searchLimits.recoveryShort : searchLimits.short;
  return {
    short: Math.max(0, short - counts.short),
    general: Math.max(0, (recovering ? searchLimits.recoveryDaily : searchLimits.daily) - counts.daily),
    priority: Math.max(0, searchLimits.priorityDaily - counts.priorityDaily),
  };
}
export function isPriorityTarget(
  target: Pick<AcquisitionTarget, "origin" | "created_at">,
  now = Date.now(),
) {
  if (target.origin !== "migration") return true;
  const created = new Date(
    target.created_at.endsWith("Z")
      ? target.created_at
      : `${target.created_at.replace(" ", "T")}Z`,
  ).getTime();
  return Number.isFinite(created) && now - created <= priorityWindow;
}
export function orderSearchTargets(
  values: AcquisitionTarget[],
  now = Date.now(),
) {
  const rank = (target: AcquisitionTarget) =>
    target.origin === "user"
      ? 0
      : target.origin === "playlist"
        ? 1
        : isPriorityTarget(target, now)
          ? 2
          : 3;
  const time = (value?: string | null) =>
    value
      ? new Date(
          value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
        ).getTime()
      : 0;
  return [...values].sort((a, b) => {
    const difference = rank(a) - rank(b);
    if (difference) return difference;
    if (rank(a) < 3)
      return time(b.created_at) - time(a.created_at) || a.id - b.id;
    const unsearched =
      Number(Boolean(a.last_search_at)) - Number(Boolean(b.last_search_at));
    if (unsearched) return unsearched;
    return (
      a.attempts_today - b.attempts_today ||
      time(a.last_search_at) - time(b.last_search_at) ||
      time(a.created_at) - time(b.created_at) ||
      a.id - b.id
    );
  });
}
export function diversifySearchTargets<T extends Pick<AcquisitionTarget, "id" | "lidarr_artist_id">>(
  values: T[],
  capacity: number,
): T[] {
  if (capacity <= 0) return [];
  const selected: T[] = [],
    deferred: T[] = [],
    artists = new Set<string>();
  for (const target of values) {
    const artist = target.lidarr_artist_id == null
      ? `target:${target.id}`
      : `artist:${target.lidarr_artist_id}`;
    if (artists.has(artist)) deferred.push(target);
    else {
      artists.add(artist);
      selected.push(target);
      if (selected.length === capacity) return selected;
    }
  }
  return selected.concat(deferred.slice(0, capacity - selected.length));
}
export function balancedSearchTargets<T extends AcquisitionTarget & { search_count?: number }>(
  values: T[],
  capacity: number,
  now = Date.now(),
): T[] {
  if (capacity <= 0) return [];
  const ordered = orderSearchTargets(values, now) as T[],
    retries = ordered
      .filter((target) => Boolean(target.last_search_at))
      .sort((a, b) =>
        Number(shouldUseFallback(b, Number(b.search_count ?? 0))) -
          Number(shouldUseFallback(a, Number(a.search_count ?? 0))) ||
        String(a.last_search_at).localeCompare(String(b.last_search_at)),
      ),
    fresh = ordered.filter((target) => !target.last_search_at),
    retrySlots = retries.length
      ? fresh.length
        ? Math.max(1, Math.ceil(capacity * 0.4))
        : capacity
      : 0,
    selected = diversifySearchTargets(retries, retrySlots),
    selectedIds = new Set(selected.map((target) => target.id));
  selected.push(...diversifySearchTargets(
    fresh.filter((target) => !selectedIds.has(target.id)),
    capacity - selected.length,
  ));
  for (const target of selected) selectedIds.add(target.id);
  if (selected.length < capacity) selected.push(...diversifySearchTargets(
    retries.filter((target) => !selectedIds.has(target.id)),
    capacity - selected.length,
  ));
  return selected;
}
export function isManagedIncomplete(item: { state: string; progress: number }) {
  return (
    item.state !== "missingFiles" &&
    (item.progress < 1 || item.state.includes("meta"))
  );
}
export function isStaleOrphan(
  item: { state: string; added_on: number },
  queued: boolean,
  now = Date.now(),
) {
  return (
    !queued &&
    item.state === "missingFiles" &&
    now - item.added_on * 1_000 >= 24 * hour
  );
}
export function stalledDecision(
  target: AcquisitionTarget,
  now: DownloadObservation,
  previous?: DownloadObservation,
  ageHours = 0,
): InterventionDecision | null {
  const progressed = Boolean(previous && now.downloaded > previous.downloaded);
  if (progressed || now.speed > 0 || now.connectedSeeds > 0) return null;
  const metadata = now.progress === 0 && now.amountLeft === 0;
  if (metadata && ageHours >= 2)
    return {
      action: "replace",
      reason: "Magnet metadata remained unavailable after reannounces",
      destructive: true,
      targetId: target.id,
      hash: now.hash,
    };
  if (now.progress === 0 && now.availability === 0 && ageHours >= 2)
    return {
      action: "replace",
      reason: "No bytes or reachable pieces after two hours",
      destructive: true,
      targetId: target.id,
      hash: now.hash,
    };
  const idle = hoursSince(target.last_progress_at ?? target.first_queued_at);
  const grace = target.origin === "migration"
    ? (now.progress >= 0.9 ? 48 : 8)
    : (now.progress >= 0.9 ? 24 : 4);
  if (idle >= grace && ageHours >= grace && now.availability <= now.progress + 0.001)
    return {
      action: "replace",
      reason: `No byte progress or reachable source for ${grace} hours`,
      destructive: true,
      targetId: target.id,
      hash: now.hash,
    };
  return null;
}
export function releaseScore(item: {
  seeders: number;
  size: number;
  trackCount: number;
  quality: string;
  sourceScore: number;
  importRate: number;
}) {
  const lossless = /flac|alac|ape|wavpack/i.test(item.quality),
    mp3 = /mp3.*(v0|320)/i.test(item.quality);
  if (!lossless && !mp3) return -Infinity;
  const bytesPerTrack = Math.max(1, item.size / Math.max(1, item.trackCount));
  return (
    Math.log2(item.seeders + 1) * 28 +
    Math.log2(item.trackCount + 1) * 9 -
    Math.log2(bytesPerTrack / 1e6 + 1) * 5 +
    item.sourceScore * 20 +
    item.importRate * 20 +
    (lossless ? 12 : 0)
  );
}
export function retryDelay(attempts: number) {
  return attempts <= 1 ? 6 : attempts === 2 ? 24 : 72;
}

export function shouldUseFallback(target: Pick<AcquisitionTarget, "origin" | "created_at">, searches: number) {
  const grace = target.origin === "user" ? 6 : target.origin === "playlist" ? 12 : 24;
  return searches >= 1 && hoursSince(target.created_at) >= grace;
}
