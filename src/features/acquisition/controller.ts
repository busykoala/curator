import { db, stateGet, stateSet } from "@/features/db/client";
import { runtimeSettings } from "@/features/settings/runtime";
import {
  blocklistQueue,
  queue,
  wantedMissing,
  type QueueItem,
  type Wanted,
} from "./lidarr";
import {
  connectivityProbe,
  qbitPreferences,
  qbitTorrents,
  qbitTransfer,
  reannounce,
  removeTorrent,
  setPreferences,
  topPriority,
  type Torrent,
} from "./qbittorrent";
import {
  controllerMode,
  balancedSearchTargets,
  isManagedIncomplete,
  isStaleOrphan,
  isPriorityTarget,
  orderSearchTargets,
  retryDelay,
  searchBudget,
  shouldUseFallback,
  stalledDecision,
} from "./policy";
import {
  acquireControllerLease,
  destructiveAllowed,
  intervene,
  observe,
  targetByAlbum,
  targets,
  updateTarget,
  upsertTarget,
} from "./repository";
import { findRelease } from "./search";
import { maintainSources } from "./prowlarr";
import { exactManualImport } from "./manual-import";
import type { AcquisitionTarget, DownloadObservation } from "./types";

let running = false,
  timer: NodeJS.Timeout | undefined,
  actionTimer: NodeJS.Timeout | undefined;
const iso = () => new Date().toISOString();
function observationUntil() {
  let value = Number(stateGet("acquisition_observation_until", "0"));
  if (!value) {
    value = Date.now() + 30 * 60_000;
    stateSet("acquisition_observation_until", String(value));
  }
  return value;
}
function previous(hash: string) {
  const row = db()
    .prepare(
      "SELECT target_id targetId,torrent_hash hash,state,downloaded,amount_left amountLeft,progress,download_speed speed,connected_seeds connectedSeeds,reported_seeds reportedSeeds,availability,tracker FROM download_observations WHERE torrent_hash=? ORDER BY id DESC LIMIT 1",
    )
    .get(hash) as DownloadObservation | undefined;
  return row;
}
function recordTorrent(item: Torrent, target: AcquisitionTarget | null) {
  const before = previous(item.hash),
    value: DownloadObservation = {
      targetId: target?.id ?? null,
      hash: item.hash,
      state: item.state,
      downloaded: item.downloaded,
      amountLeft: item.amount_left,
      progress: item.progress,
      speed: item.dlspeed,
      connectedSeeds: item.num_seeds,
      reportedSeeds: item.num_complete,
      availability: item.availability,
      tracker: item.tracker,
    };
  observe(value);
  if (target) {
    const patch: Record<string, unknown> = {
      download_hash: item.hash,
      status: item.progress >= 1 ? "downloaded" : "downloading",
      last_size_left: item.amount_left,
    };
    if (before && item.downloaded > before.downloaded)
      patch.last_progress_at = iso();
    updateTarget(target.id, patch);
  }
  return { before, value };
}
function synchronizeTargets(wanted: Wanted[]) {
  const existing = targets(),
    known = new Set(existing.map((target) => target.lidarr_album_id)),
    bootstrapped =
      stateGet("acquisition_bootstrapped") === "true" || existing.length > 0;
  for (const album of wanted)
    upsertTarget({
      albumId: album.id,
      artistId: album.artistId,
      origin: bootstrapped && !known.has(album.id) ? "user" : "migration",
      artist: album.artist?.artistName,
      title: album.title,
    });
  stateSet("acquisition_bootstrapped", "true");
  const missing = new Set(wanted.map((item) => item.id));
  for (const target of targets()) {
    if (!missing.has(target.lidarr_album_id) && target.status !== "imported") {
      updateTarget(target.id, {
        status: "imported",
        imported_at: iso(),
        next_retry_at: null,
      });
    } else if (
      missing.has(target.lidarr_album_id) &&
      target.status === "imported"
    ) {
      updateTarget(target.id, {
        status: "pending",
        imported_at: null,
        download_hash: null,
        first_queued_at: null,
        last_progress_at: null,
        last_size_left: null,
        attempts_today: 0,
        attempts_day: null,
        next_retry_at: null,
      });
    }
  }
}
function acquisitionQuota(recovering: boolean) {
  const row = db()
    .prepare(
      `SELECT sum(created_at>=datetime('now','-15 minutes')) short,
        count(*) daily,
        sum(coalesce(json_extract(evidence_json,'$.priority'),0)=1) priorityDaily
        FROM download_interventions
        WHERE action='search' AND status='applied' AND created_at>=datetime('now','-1 day')`,
    )
    .get() as {
    short: number | null;
    daily: number;
    priorityDaily: number | null;
  };
  return searchBudget({
    short: Number(row.short ?? 0),
    daily: Number(row.daily ?? 0),
    priorityDaily: Number(row.priorityDaily ?? 0),
  }, recovering);
}
function failedSearchPatch(target: AcquisitionTarget, error: unknown) {
  const searchedAt = iso(),
    day = searchedAt.slice(0, 10),
    attempts = target.attempts_day === day ? target.attempts_today + 1 : 1;
  return {
    status: "pending",
    attempts_today: attempts,
    attempts_day: day,
    last_search_at: searchedAt,
    next_retry_at: new Date(
      Date.now() + retryDelay(attempts) * 3_600_000,
    ).toISOString(),
    detail_json: JSON.stringify({ error: String(error) }),
  };
}
async function replace(
  item: QueueItem,
  target: AcquisitionTarget,
  reason: string,
  apply: boolean,
) {
  const evidence = { reason, title: item.title };
  if (!apply) {
    intervene({
      targetId: target.id,
      hash: target.download_hash ?? undefined,
      action: "replace",
      status: "proposed",
      evidence,
    });
    return;
  }
  if (!destructiveAllowed()) {
    intervene({
      targetId: target.id,
      hash: target.download_hash ?? undefined,
      action: "replace",
      status: "deferred",
      evidence: { ...evidence, gate: "five per 15 minutes / 20 per hour" },
    });
    return;
  }
  await blocklistQueue(item);
  updateTarget(target.id, {
    status: "pending",
    download_hash: null,
    next_retry_at: iso(),
    detail_json: JSON.stringify({ reason }),
  });
  intervene({
    targetId: target.id,
    hash: target.download_hash ?? undefined,
    action: "replace",
    status: "applied",
    evidence,
  });
}
async function repairImports(items: QueueItem[], apply: boolean) {
  for (const item of items
    .filter((value) => value.trackedDownloadState === "importFailed")
    .slice(0, 5)) {
    let target = item.albumId ? targetByAlbum(item.albumId) : undefined;
    if (!target && item.albumId) {
      upsertTarget({
        albumId: item.albumId,
        artistId: item.artistId,
        origin: "migration",
        title: item.title,
      });
      target = targetByAlbum(item.albumId);
    }
    if (!target) continue;
    const obvious =
      /box.?set|deluxe|super deluxe|\b\d+\s*(cd|disc)|edition|track.?list|mismatch/i.test(
        `${item.title ?? ""} ${item.errorMessage ?? ""}`,
      );
    let exact = false;
    if (apply && !obvious)
      exact = await exactManualImport(item).catch(() => false);
    if (exact) {
      intervene({
        targetId: target.id,
        hash: item.downloadId,
        action: "manual-import",
        status: "applied",
        evidence: { title: item.title },
      });
      continue;
    }
    await replace(
      item,
      target,
      item.errorMessage ?? "Edition or track-list mismatch",
      apply,
    );
  }
}
async function cleanupOrphans(
  torrents: Torrent[],
  queueByHash: Map<string, QueueItem>,
  apply: boolean,
) {
  for (const item of torrents.filter((torrent) =>
    isStaleOrphan(torrent, queueByHash.has(torrent.hash.toLowerCase())),
  )) {
    const evidence = {
      reason: "Torrent payload is already absent and Lidarr no longer tracks it",
      state: item.state,
      ageHours: Math.round((Date.now() - item.added_on * 1_000) / 3_600_000),
    };
    if (!apply) {
      intervene({ hash: item.hash, action: "cleanup", status: "proposed", evidence });
      continue;
    }
    if (!destructiveAllowed()) {
      intervene({ hash: item.hash, action: "cleanup", status: "deferred", evidence });
      continue;
    }
    // missingFiles means qBittorrent has no payload to delete. Remove only the
    // stale client record so a later Lidarr search can add a clean download.
    await removeTorrent(item.hash, false);
    intervene({ hash: item.hash, action: "cleanup", status: "applied", evidence });
  }
}
async function tune(torrents: Torrent[], apply: boolean) {
  if (!apply) return;
  const productive = torrents.filter(
      (item) => item.dlspeed > 0 || item.num_seeds > 0,
    ).length,
    throughput = torrents.reduce((sum, item) => sum + item.dlspeed, 0),
    settings = runtimeSettings(),
    preferred = torrents
      .filter(
        (item) => item.dlspeed > 0 || item.num_seeds > 0 || item.progress > 0.9,
      )
      .sort((a, b) => b.dlspeed - a.dlspeed || b.progress - a.progress)
      .slice(0, 24)
      .map((item) => item.hash);
  if (!stateGet("acquisition_qbit_initialized")) {
    await setPreferences({
      queueing_enabled: true,
      max_active_downloads: 24,
      max_active_torrents: 60,
      dont_count_slow_torrents: true,
      dht: true,
      pex: true,
      lsd: true,
      announce_to_all_trackers: true,
    });
    stateSet("acquisition_qbit_initialized", "true");
    stateSet("acquisition_slots", "24");
    stateSet("acquisition_slots_at", String(Date.now()));
    await topPriority(preferred);
    return;
  }
  const prefs = await qbitPreferences(),
    current = Number(prefs.max_active_downloads ?? 24),
    raw = stateGet("acquisition_slot_test"),
    test = raw
      ? (JSON.parse(raw) as {
          from: number;
          to: number;
          baseline: number;
          started: number;
        })
      : null;
  if (test && Date.now() - test.started >= 15 * 60_000) {
    const keep = throughput >= test.baseline * 0.95;
    if (!keep)
      await setPreferences({
        max_active_downloads: test.from,
        max_active_torrents: test.from + 36,
      });
    stateSet("acquisition_slots", String(keep ? test.to : test.from));
    stateSet("acquisition_slot_test", "");
    stateSet("acquisition_slots_at", String(Date.now()));
  } else if (
    !test &&
    Date.now() - Number(stateGet("acquisition_slots_at", "0")) >= 15 * 60_000
  ) {
    const desired = Math.max(
      settings.activeDownloadMin,
      Math.min(
        settings.activeDownloadMax,
        productive < 6
          ? current - 6
          : productive > current * 0.7
            ? current + 6
            : current,
      ),
    );
    if (desired !== current) {
      await setPreferences({
        max_active_downloads: desired,
        max_active_torrents: desired + 36,
      });
      stateSet(
        "acquisition_slot_test",
        JSON.stringify({
          from: current,
          to: desired,
          baseline: throughput,
          started: Date.now(),
        }),
      );
      stateSet("acquisition_slots", String(desired));
    }
  }
  await topPriority(preferred);
}
async function searchWork(
  mode: "bulk" | "completion",
  queueItems: QueueItem[],
  apply: boolean,
  incomplete: number,
) {
  const settings = runtimeSettings(),
    active = new Set(queueItems.map((item) => item.albumId)),
    now = Date.now(),
    rows = (
      db()
        .prepare(
          `SELECT acquisition_targets.*,
            (SELECT count(*) FROM download_interventions
              WHERE target_id=acquisition_targets.id AND action='search' AND status='applied') search_count
          FROM acquisition_targets
          WHERE status IN ('pending','staged')
            AND (next_retry_at IS NULL OR datetime(next_retry_at)<=CURRENT_TIMESTAMP)
            AND (attempts_day IS NULL OR attempts_day<>date('now') OR attempts_today<3)`,
        )
        .all() as AcquisitionTarget[]
    ).filter((target) => !active.has(target.lidarr_album_id)),
    ordered = orderSearchTargets(rows, now),
    quota = apply
      ? acquisitionQuota(mode === "bulk" && incomplete < settings.activeDownloadMin)
      : { short: 10, general: 10, priority: 10 },
    priority = ordered.filter((target) => isPriorityTarget(target, now)),
    priorityCapacity = Math.min(
      quota.short,
      Math.max(quota.general, quota.priority),
    ),
    selected = priority.slice(0, priorityCapacity),
    selectedIds = new Set(selected.map((target) => target.id)),
    generalCapacity = Math.min(
      quota.short - selected.length,
      Math.max(0, quota.general - selected.length),
    );
  selected.push(...balancedSearchTargets(
    ordered.filter(
      (target) => !selectedIds.has(target.id) && !isPriorityTarget(target, now),
    ),
    generalCapacity,
    now,
  ));
  stateSet("acquisition_search_status", JSON.stringify({ eligible: rows.length, selected: selected.length, budget: quota, recovering: mode === "bulk" && incomplete < settings.activeDownloadMin }));
  const run = async (target: AcquisitionTarget) => {
    const priorityTarget = isPriorityTarget(target, now),
      searches = Number((db().prepare("SELECT count(*) count FROM download_interventions WHERE target_id=? AND action='search' AND status='applied'").get(target.id) as { count: number }).count),
      fallback =
        settings.qualityFallback &&
        shouldUseFallback(target, searches);
    intervene({
      targetId: target.id,
      action: "search",
      status: apply ? "applied" : "proposed",
      evidence: { mode, fallback, priority: priorityTarget },
    });
    if (apply)
      await findRelease(target, fallback).catch((error) =>
        updateTarget(target.id, failedSearchPatch(target, error)),
      );
  };
  for (let index = 0; index < selected.length; index += 2) {
    const batch = selected.slice(index, index + 2);
    // Fallback temporarily changes the artist's quality profile. Searches for
    // the same artist must finish restoring it before another one starts.
    if (batch.length === 2 && batch[0].lidarr_artist_id != null &&
        batch[0].lidarr_artist_id === batch[1].lidarr_artist_id) {
      for (const target of batch) await run(target);
    } else await Promise.all(batch.map(run));
  }
}
async function cleanupImported(torrents: Torrent[], apply: boolean) {
  const settings = runtimeSettings();
  for (const target of targets().filter(
    (value) => value.status === "imported" && value.download_hash,
  )) {
    const item = torrents.find(
      (value) =>
        value.hash.toLowerCase() === target.download_hash?.toLowerCase(),
    );
    if (!item || item.progress < 1) continue;
    const age = (Date.now() - item.completion_on * 1000) / 86_400_000;
    if (item.ratio < settings.seedRatio && age < settings.seedDays) continue;
    const evidence = { ratio: item.ratio, age };
    if (!apply) {
      intervene({
        targetId: target.id,
        hash: item.hash,
        action: "cleanup",
        status: "proposed",
        evidence,
      });
      continue;
    }
    if (!destructiveAllowed()) {
      intervene({
        targetId: target.id,
        hash: item.hash,
        action: "cleanup",
        status: "deferred",
        evidence,
      });
      continue;
    }
    await removeTorrent(item.hash, true);
    intervene({
      targetId: target.id,
      hash: item.hash,
      action: "cleanup",
      status: "applied",
      evidence,
    });
  }
}
export async function runAcquisitionCycle() {
  if (running || !acquireControllerLease()) return;
  running = true;
  stateSet("acquisition_running", "true");
  try {
    const settings = runtimeSettings(),
      paused = stateGet("acquisition_paused") === "true",
      observeOnly = Date.now() < observationUntil(),
      apply = settings.acquisitionAutomation && !paused && !observeOnly;
    stateSet("acquisition_phase", "observing");
    const [wanted, queueItems, torrents, transfer] = await Promise.all([
      wantedMissing(),
      queue(),
      qbitTorrents(),
      qbitTransfer(),
    ]);
    synchronizeTargets(wanted);
    const queueByHash = new Map(
      queueItems
        .filter((item) => item.downloadId)
        .map((item) => [item.downloadId!.toLowerCase(), item]),
    );
    const observations = torrents.map((item) => {
      const queued = queueByHash.get(item.hash.toLowerCase()),
        target = queued?.albumId
          ? (targetByAlbum(queued.albumId) ?? null)
          : null;
      if (target && !target.first_queued_at)
        updateTarget(target.id, {
          first_queued_at: queued?.added ?? iso(),
          source_name: queued?.indexer ?? null,
        });
      return { item, target, ...recordTorrent(item, target) };
    });
    const managed = observations.filter(
        (row) => row.target && isManagedIncomplete(row.item),
      ),
      incomplete = managed.map((row) => row.item),
      orphaned = observations.filter(
        (row) => !row.target && row.item.progress < 1,
      ).length;
    const migration = targets().filter(
      (item) => item.origin === "migration" && item.status !== "imported",
    ).length;
    if (
      migration <= settings.bulkMigrationThreshold &&
      incomplete.length <= settings.completionIncompleteThreshold
    ) {
      if (!stateGet("completion_candidate_since"))
        stateSet("completion_candidate_since", String(Date.now()));
    } else stateSet("completion_candidate_since", "0");
    const mode = controllerMode(
      migration,
      incomplete.length,
      (Date.now() - Number(stateGet("completion_candidate_since", "0"))) /
        3_600_000,
      settings.bulkMigrationThreshold,
      settings.completionIncompleteThreshold,
    );
    stateSet("acquisition_mode", mode);
    const lastBytes = Number(stateGet("acquisition_downloaded", "0")),
      progressed =
        transfer.dl_info_data > lastBytes || transfer.dl_info_speed > 0;
    stateSet("acquisition_downloaded", String(transfer.dl_info_data));
    if (progressed) stateSet("acquisition_idle_since", "0");
    else if (stateGet("acquisition_idle_since", "0") === "0")
      stateSet("acquisition_idle_since", String(Date.now()));
    const idleSince = Number(stateGet("acquisition_idle_since", "0")),
      idleMinutes = idleSince
        ? Math.max(0, (Date.now() - idleSince) / 60_000)
        : 0;
    let sourceHealthy = true;
    if (incomplete.length > 0 && idleMinutes >= 30) {
      stateSet("acquisition_phase", "diagnosing");
      if (
        apply &&
        Date.now() - Number(stateGet("acquisition_probe_at", "0")) > 30 * 60_000
      ) {
        const probe = await connectivityProbe().catch((error) => ({ ok: false, error: String(error) }));
        stateSet("acquisition_probe", JSON.stringify(probe));
        stateSet("acquisition_probe_at", String(Date.now()));
        sourceHealthy = probe.ok;
      } else
        sourceHealthy =
          JSON.parse(stateGet("acquisition_probe", '{"ok":true}')).ok !== false;
    }
    let staleRepairs = 0;
    for (const row of managed) {
      const target = row.target!;
      const age = (Date.now() - row.item.added_on * 1000) / 3_600_000;
      if ((age >= 0.25 && age < 0.5) || (age >= 1 && age < 1.25)) {
        intervene({
          targetId: target.id,
          hash: row.item.hash,
          action: "reannounce",
          status: apply ? "applied" : "proposed",
          evidence: { age },
        });
        if (apply) await reannounce(row.item.hash);
      }
      const decision = stalledDecision(target, row.value, row.before, age);
      if (decision && sourceHealthy && staleRepairs < 5) {
        const queued = queueByHash.get(row.item.hash.toLowerCase());
        if (queued) {
          await replace(queued, target, decision.reason, apply);
          staleRepairs++;
        }
      }
    }
    stateSet("acquisition_phase", "repairing");
    await cleanupOrphans(torrents, queueByHash, apply);
    await repairImports(queueItems, apply);
    await tune(torrents, apply);
    await cleanupImported(torrents, apply);
    stateSet("acquisition_phase", "searching");
    await searchWork(mode, queueItems, apply, incomplete.length);
    if (Date.now() - Number(stateGet("source_test_at", "0")) > 6 * 3_600_000) {
      await maintainSources(apply);
      stateSet("source_test_at", String(Date.now()));
    }
    stateSet(
      "acquisition_summary",
      JSON.stringify({
        mode,
        observeOnly,
        paused,
        apply,
        wanted: wanted.length,
        incomplete: incomplete.length,
        orphaned,
        productive: incomplete.filter(
          (item) => item.dlspeed > 0 || item.num_seeds > 0,
        ).length,
        downloadSpeed: transfer.dl_info_speed,
        importFailures: queueItems.filter(
          (item) => item.trackedDownloadState === "importFailed",
        ).length,
        idleMinutes: Math.round(idleMinutes),
        sourceHealthy,
        updatedAt: iso(),
      }),
    );
    stateSet("acquisition_last_error", "");
  } catch (error) {
    stateSet("acquisition_last_error", String(error));
  } finally {
    stateSet("acquisition_phase", "idle");
    stateSet("acquisition_running", "false");
    stateSet("acquisition_lease", "0");
    running = false;
  }
}
export function startAcquisitionController() {
  if (timer) return;
  setTimeout(() => void runAcquisitionCycle(), 4_000);
  timer = setInterval(() => void runAcquisitionCycle(), 5 * 60_000);
  actionTimer = setInterval(() => {
    if (stateGet("acquisition_requested_action") === "run" && !running) {
      stateSet("acquisition_requested_action", "");
      void runAcquisitionCycle();
    }
  }, 2_000);
  process.once("SIGTERM", () => {
    if (timer) clearInterval(timer);
    if (actionTimer) clearInterval(actionTimer);
  });
}
