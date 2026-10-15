import { db, stateGet, stateSet } from "@/features/db/client";
import { runtimeSettings } from "@/features/settings/runtime";
import {
  blocklistQueue,
  queue,
  wantedMissing,
  album,
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
  diversifySearchTargets,
  isManagedIncomplete,
  isStaleOrphan,
  isPriorityTarget,
  orderSearchTargets,
  retryDelay,
  searchBudget,
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
import { recoverQualityProfiles } from "./quality";
import { findRelease } from "./search";
import { hasArtistCache } from "./discovery";
import { maintainSources } from "./prowlarr";
import { exactManualImport } from "./manual-import";
import {reconcileSubmissions} from './submissions';
import type { AcquisitionTarget, DownloadObservation } from "./types";

let running = false,
  timer: NodeJS.Timeout | undefined,
  actionTimer: NodeJS.Timeout | undefined;
const iso = () => new Date().toISOString();
function recordSourceOutcome(target: AcquisitionTarget, event: string, detail: Record<string, unknown> = {}) {
  if (!target.source_name) return;
  db().prepare("INSERT INTO source_outcomes(indexer_name,event,detail_json) VALUES(?,?,?)").run(
    target.source_name,
    event,
    JSON.stringify({ albumId: target.lidarr_album_id, ...detail }),
  );
}
function recordSourceOutcomeOnce(target: AcquisitionTarget, event: string, hash: string, detail: Record<string, unknown> = {}) {
  const exists = db().prepare("SELECT 1 FROM source_outcomes WHERE event=? AND json_extract(detail_json,'$.hash')=? LIMIT 1").get(event, hash);
  if (!exists) recordSourceOutcome(target, event, { hash, ...detail });
}
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
  if (target && target.status !== "imported" && target.status !== "inactive") {
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
export async function synchronizeTargets(wanted: Wanted[], queueItems:QueueItem[]=[]) {
  const missing=new Set(wanted.map(a=>a.id)),active=new Set(queueItems.map(a=>a.albumId));
  db().transaction(()=>{
    for(const item of wanted){
      const request=db().prepare("SELECT 1 FROM music_requests WHERE lidarr_album_id=?").get(item.id);
      upsertTarget({albumId:item.id,artistId:item.artistId,origin:request?'user':'migration',artist:item.artist?.artistName,title:item.title});
    }
    stateSet('acquisition_bootstrapped','true');
  })();
  for(const target of targets()){
    if(missing.has(target.lidarr_album_id)){
      if(['imported','inactive'].includes(target.status)){
        db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
        updateTarget(target.id,{status:'pending',wanted_since:iso(),attempts_today:0,attempts_day:null,imported_at:null,download_hash:null,first_queued_at:null,last_progress_at:null,last_size_left:null,next_retry_at:null});
      }else if(!active.has(target.lidarr_album_id)&&['queued','downloading','downloaded'].includes(target.status)){
        const pending=db().prepare("SELECT status FROM acquisition_submissions WHERE target_id=?").get(target.id) as {status:string}|undefined;
        if(!pending||pending.status==='confirmed'){
          db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
          updateTarget(target.id,{status:'pending',download_hash:null,next_retry_at:null,detail_json:JSON.stringify({reason:'Previously tracked transfer is absent; checking sources again'})});
        }else updateTarget(target.id,{detail_json:JSON.stringify({reason:'Submission awaiting transfer confirmation; no duplicate will be submitted'})});
      }
      continue;
    }
    if(['imported','inactive'].includes(target.status))continue;
    // Absence from /wanted/missing can also mean unmonitored or removed. Only
    // actual file statistics confirm an import; a complete snapshot is required.
    const actual=await album(target.lidarr_album_id).catch(()=>null);
    if(!actual)continue;
    if((actual.statistics?.percentOfTracks??0)>=100&&(actual.statistics?.trackFileCount??0)>0){
      if(target.download_hash)recordSourceOutcomeOnce(target,'import',target.download_hash);
      updateTarget(target.id,{status:'imported',imported_at:iso(),next_retry_at:null});
      db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
    }else if(!actual.monitored){
      updateTarget(target.id,{status:'inactive',next_retry_at:null,detail_json:JSON.stringify({reason:'Album is not monitored'})});
      db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
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
        WHERE action='search' AND status='applied' AND json_extract(evidence_json,'$.strategyVersion')=2 AND created_at>=datetime('now','-1 day')`,
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
    attempts_today: target.attempts_today,
    attempts_day: day,
    last_search_at: searchedAt,
    next_retry_at: new Date(
      Date.now() + 5 * 60_000,
    ).toISOString(),
    detail_json: JSON.stringify({ reason:'Search service error; retry scheduled', error: String(error), strategyVersion:2 }),
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
  recordSourceOutcomeOnce(target, "replacement",target.download_hash??item.downloadId??'', { reason, guid:target.last_release_guid });
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
    .filter((value) =>
      value.trackedDownloadState === "importFailed" ||
      (value.status === 'completed' && value.trackedDownloadState === 'importPending' && Number(value.sizeleft??0)===0) ||
      (value.status === "completed" && value.trackedDownloadStatus === "warning" && Number(value.sizeleft ?? 0) === 0 &&
        value.statusMessages?.some((status) => status.messages?.some((message) => /unable to import automatically/i.test(message))))
    )
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
    const obvious =
      /box.?set|deluxe|super deluxe|\b\d+\s*(cd|disc)|edition|track.?list|mismatch/i.test(
        `${item.title ?? ""} ${item.errorMessage ?? ""}`,
      );
    let exact: Awaited<ReturnType<typeof exactManualImport>> = false;
    if (apply)
      exact = await exactManualImport(item).catch(() => false);
    if (exact) {
      if (!target) {
        upsertTarget({
          albumId: exact.albumId,
          artistId: exact.artistId,
          origin: "migration",
          artist: exact.artist,
          title: exact.album || item.title,
        });
        target = targetByAlbum(exact.albumId);
      }
      if (!target) continue;
      updateTarget(target.id, {
        status: "downloaded",
        download_hash: item.downloadId ?? null,
        next_retry_at: null,
        detail_json: JSON.stringify({ reason: "Exact manual import completed" }),
      });
      intervene({
        targetId: target.id,
        hash: item.downloadId,
        action: "manual-import",
        status: "applied",
        evidence: { title: item.title },
      });
      continue;
    }
    if (!target) {
      intervene({
        hash: item.downloadId,
        action: "manual-import",
        status: "deferred",
        evidence: { title: item.title, reason: "No unique album identity" },
      });
      continue;
    }
    // A failed import does not prove a bad torrent. Preserve completed audio
    // and report the mapping/archive problem instead of repeatedly blocklisting.
    updateTarget(target.id,{status:'downloaded',detail_json:JSON.stringify({reason:item.errorMessage??'Import needs review',messages:item.statusMessages,editionHint:obvious})});
    intervene({targetId:target.id,hash:item.downloadId,action:'manual-import',status:'deferred',evidence:{title:item.title,reason:'No unambiguous import mapping; payload retained'}});
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
      break;
    }
    // missingFiles means qBittorrent has no payload to delete. Remove only the
    // stale client record so a later Lidarr search can add a clean download.
    await removeTorrent(item.hash, false);
    intervene({ hash: item.hash, action: "cleanup", status: "applied", evidence });
  }
  const settings = runtimeSettings(),
    targetHashes = new Set(
      targets()
        .map((target) => target.download_hash?.toLowerCase())
        .filter((hash): hash is string => Boolean(hash)),
    );
  for (const item of torrents) {
    const hash = item.hash.toLowerCase();
    if (
      item.progress < 1 ||
      !item.completion_on ||
      queueByHash.has(hash) ||
      targetHashes.has(hash)
    ) continue;
    const ageDays = (Date.now() - item.completion_on * 1_000) / 86_400_000;
    if (item.ratio < settings.seedRatio && ageDays < settings.seedDays) continue;
    const evidence = {
      reason: "Completed torrent is no longer tracked by Lidarr; payload preserved",
      ratio: item.ratio,
      ageDays: Math.round(ageDays),
    };
    if (!apply) {
      intervene({ hash: item.hash, action: "cleanup", status: "proposed", evidence });
      continue;
    }
    if (!destructiveAllowed()) {
      intervene({ hash: item.hash, action: "cleanup", status: "deferred", evidence });
      break;
    }
    await removeTorrent(item.hash, false);
    intervene({ hash: item.hash, action: "cleanup", status: "applied", evidence });
  }
}
async function cleanupUnmonitoredQueue(
  items: QueueItem[],
  wanted: Set<number>,
  torrents: Torrent[],
  apply: boolean,
) {
  for (const item of items) {
    if (!item.albumId || wanted.has(item.albumId) || !item.downloadId) continue;
    const torrent = torrents.find((value) => value.hash.toLowerCase() === item.downloadId?.toLowerCase());
    if (!torrent || torrent.progress >= 1 || torrent.dlspeed > 0 || torrent.num_seeds > 0) continue;
    const ageHours = (Date.now() - torrent.added_on * 1_000) / 3_600_000;
    if (ageHours < 24 || torrent.availability > torrent.progress + 0.001) continue;
    const evidence = { reason: "Stalled download belongs to an album Lidarr no longer monitors", title: item.title, ageHours: Math.round(ageHours) };
    if (!apply) {
      intervene({ hash: torrent.hash, action: "cleanup", status: "proposed", evidence });
      continue;
    }
    if (!destructiveAllowed()) {
      intervene({ hash: torrent.hash, action: "cleanup", status: "deferred", evidence });
      continue;
    }
    await blocklistQueue(item);
    intervene({ hash: torrent.hash, action: "cleanup", status: "applied", evidence });
  }
}
async function tune(torrents: Torrent[], apply: boolean) {
  if (!apply) return;
  const productive = torrents.filter(
      (item) => item.progress < 1 && (item.dlspeed > 0 || item.num_seeds > 0),
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
    const keep = test.baseline > 0 && throughput >= test.baseline * 0.95;
    if (!keep)
      await setPreferences({
        max_active_downloads: test.from,
        max_active_torrents: test.from + 36,
      });
    stateSet("acquisition_slots", String(keep ? test.to : test.from));
    stateSet("acquisition_slot_test", "");
    stateSet("acquisition_slots_at", String(Date.now()));
  } else if (
    !test && productive > 0 && throughput > 0 &&
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
  wanted: Wanted[],
) {
  if(incomplete>=96)return;
  const currentWanted=new Set(wanted.map(a=>a.id)),wantedTypes=new Map(wanted.map(a=>[a.id,a.albumType]));
  const settings = runtimeSettings(),
    active = new Set(queueItems.map((item) => item.albumId)),
    now = Date.now(),
    recovering = mode === "bulk" && incomplete < settings.activeDownloadMin,
    rows = (
      db()
        .prepare(
          `SELECT acquisition_targets.*,
            (SELECT count(*) FROM download_interventions
              WHERE target_id=acquisition_targets.id AND action='search' AND status='applied') search_count
          FROM acquisition_targets
          WHERE status IN ('pending','staged')
            AND (next_retry_at IS NULL OR datetime(next_retry_at)<=CURRENT_TIMESTAMP
              OR coalesce(json_extract(detail_json,'$.strategyVersion'),0)<2)
            AND (attempts_day IS NULL OR attempts_day<>date('now') OR attempts_today<3 OR coalesce(json_extract(detail_json,'$.strategyVersion'),0)<2)`,
        )
        .all() as AcquisitionTarget[]
    ).filter((target) => !active.has(target.lidarr_album_id) && currentWanted.has(target.lidarr_album_id)),
    ordered = orderSearchTargets(rows.map(target=>({...target,created_at:target.wanted_since??target.created_at,album_type:wantedTypes.get(target.lidarr_album_id),origin:
      JSON.parse(target.detail_json??'{}').operatorRetry||db().prepare('SELECT 1 FROM music_requests WHERE lidarr_album_id=?').get(target.lidarr_album_id)?'user':target.origin==='playlist'?'playlist':'migration'})), now),
    quota = apply
      ? acquisitionQuota(recovering)
      : { short: 10, general: 10, priority: 10 },
    priority = ordered.filter((target) => isPriorityTarget(target, now)),
    priorityCapacity = Math.min(
      quota.short,
      Math.max(quota.general, quota.priority),
    ),
    selected = diversifySearchTargets(priority, priorityCapacity),
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
  stateSet("acquisition_search_status", JSON.stringify({ eligible: rows.length, selected: selected.length, budget: quota, recovering }));
  const run = async (target: AcquisitionTarget) => {
    const priorityTarget = isPriorityTarget(target, now),
      fallback =
        settings.qualityFallback;
    intervene({
      targetId: target.id,
      action: "search",
      status: apply ? "applied" : "proposed",
      evidence: { mode, fallback, priority: priorityTarget, strategyVersion:2 },
    });
    if (apply){
      await findRelease(target, fallback).catch((error) =>
        updateTarget(target.id, failedSearchPatch(target, error)),
      );
      // Drain useful artist results while their native release handles are live.
      // Unmatched siblings retain their own normal search/retry schedule.
      if(target.lidarr_artist_id&&hasArtistCache(target.lidarr_artist_id)&&Date.now()<deadline){
        const siblings=targets().filter(t=>t.id!==target.id&&t.lidarr_artist_id===target.lidarr_artist_id&&['pending','staged'].includes(t.status)&&currentWanted.has(t.lidarr_album_id)&&!active.has(t.lidarr_album_id)).slice(0,6);
        for(const sibling of siblings){
          if(Date.now()>deadline)break;
          const result=await findRelease(sibling,fallback,true).catch(()=>null);
          if(result?.grabbed)intervene({targetId:sibling.id,action:'cache-match',status:'applied',evidence:{artistId:target.lidarr_artist_id,strategyVersion:2}});
        }
      }
    }
  };
  const deadline=Date.now()+90_000;
  for (let index = 0; index < selected.length; index += 2) {
    if(index>0&&Date.now()>deadline){stateSet('acquisition_requested_action','run');break}
    const batch = selected.slice(index, index + 2);
    // Fallback temporarily changes the artist's quality profile. Searches for
    // the same artist must finish restoring it before another one starts.
    const artistIds = batch
      .map((target) => target.lidarr_artist_id)
      .filter((id): id is number => id != null);
    if (new Set(artistIds).size !== artistIds.length) {
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
  const pulse=setInterval(()=>stateSet('acquisition_lease',String(Date.now()+4*60_000)),30_000);
  stateSet("acquisition_running", "true");
  try {
    await recoverQualityProfiles();
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
    await synchronizeTargets(wanted, queueItems);
    const queueByHash = new Map(
      queueItems
        .filter((item) => item.downloadId)
        .map((item) => [item.downloadId!.toLowerCase(), item]),
    );
    for(const item of queueItems){
      if(!item.albumId||!item.downloadId)continue;
      const target=targetByAlbum(item.albumId);
      if(!target)continue;
      db().prepare("UPDATE acquisition_submissions SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE target_id=?").run(target.id);
      recordSourceOutcomeOnce(target,'grab',item.downloadId.toLowerCase());
    }
    if(apply)await reconcileSubmissions(queueItems).catch(error=>console.warn(JSON.stringify({event:'acquisition_confirmation_error',error:String(error)})));
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
      if (age >= 1 && row.item.dlspeed === 0 && row.item.num_seeds === 0 && row.item.availability <= row.item.progress + 0.001)
        recordSourceOutcomeOnce(target, "unavailable", row.item.hash, { ageHours: Math.round(age) });
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
    await cleanupUnmonitoredQueue(queueItems, new Set(wanted.map((item) => item.id)), torrents, apply);
    await repairImports(queueItems, apply);
    await tune(torrents, apply);
    await cleanupImported(torrents, apply);
    stateSet("acquisition_phase", "searching");
    await searchWork(mode, queueItems, apply, incomplete.length, wanted);
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
    console.log(JSON.stringify({event:"acquisition_cycle_complete",mode,apply,wanted:wanted.length,incomplete:incomplete.length,orphaned,sourceHealthy,at:iso()}));
    stateSet("acquisition_last_error", "");
  } catch (error) {
    stateSet("acquisition_last_error", String(error));
    console.error(JSON.stringify({event:"acquisition_cycle_error",error:String(error),at:iso()}));
  } finally {
    stateSet("acquisition_phase", "idle");
    stateSet("acquisition_running", "false");
    stateSet("acquisition_lease", "0");
    clearInterval(pulse);
    running = false;
  }
}
let monitoring=false;
async function monitorTransfers(){
  if(monitoring)return;monitoring=true;
  try{
    const [items,torrents,transfer]=await Promise.all([queue(),qbitTorrents(),qbitTransfer()]);
    for(const item of items){
      if(!item.albumId||!item.downloadId)continue;
      const target=targetByAlbum(item.albumId),torrent=torrents.find(t=>t.hash.toLowerCase()===item.downloadId?.toLowerCase());
      if(!target||!torrent)continue;
      db().prepare("UPDATE acquisition_submissions SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE target_id=?").run(target.id);
      recordSourceOutcomeOnce(target,'grab',item.downloadId.toLowerCase());
      recordTorrent(torrent,target);
    }
    const raw=stateGet('acquisition_summary');
    if(raw){const summary=JSON.parse(raw);summary.downloadSpeed=transfer.dl_info_speed;summary.incomplete=torrents.filter(t=>t.progress<1).length;summary.productive=torrents.filter(t=>t.progress<1&&(t.dlspeed>0||t.num_seeds>0)).length;summary.importFailures=items.filter(i=>i.trackedDownloadState==='importFailed').length;summary.updatedAt=iso();stateSet('acquisition_summary',JSON.stringify(summary))}
  }catch(error){console.warn(JSON.stringify({event:'acquisition_monitor_error',error:String(error)}))}finally{monitoring=false}
}
export function startAcquisitionController() {
  if (timer) return;
  stateSet("acquisition_heartbeat", String(Date.now()));
  const monitorTimer=setInterval(()=>void monitorTransfers(),30_000);
  const heartbeatTimer = setInterval(
    () => stateSet("acquisition_heartbeat", String(Date.now())),
    60_000,
  );
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
    clearInterval(heartbeatTimer);
    clearInterval(monitorTimer);
  });
}
