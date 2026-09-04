import assert from "node:assert/strict";
import {
  controllerMode,
  isManagedIncomplete,
  isPriorityTarget,
  orderSearchTargets,
  releaseScore,
  searchBudget,
  stalledDecision,
} from "../src/features/acquisition/policy";
import type {
  AcquisitionTarget,
  DownloadObservation,
} from "../src/features/acquisition/types";
const target = {
  id: 1,
  lidarr_album_id: 1,
  lidarr_artist_id: 1,
  origin: "migration",
  artist: "Artist",
  title: "Album",
  status: "downloading",
  quality_phase: "lossless",
  download_hash: "hash",
  attempts_today: 0,
  attempts_day: null,
  last_search_at: null,
  next_retry_at: null,
  first_queued_at: new Date(Date.now() - 80 * 3_600_000).toISOString(),
  last_progress_at: new Date(Date.now() - 80 * 3_600_000).toISOString(),
  last_size_left: 100,
  source_name: null,
  last_release_guid: null,
  imported_at: null,
  created_at: new Date(Date.now() - 80 * 3_600_000).toISOString(),
} satisfies AcquisitionTarget;
const observation = {
  targetId: 1,
  hash: "hash",
  state: "stalledDL",
  downloaded: 50,
  amountLeft: 50,
  progress: 0.5,
  speed: 0,
  connectedSeeds: 0,
  reportedSeeds: 4,
  availability: 0.5,
} satisfies DownloadObservation;
assert.equal(controllerMode(100, 0, 100), "bulk");
assert.equal(controllerMode(20, 10, 23), "bulk");
assert.equal(controllerMode(20, 10, 24), "completion");
assert.equal(
  stalledDecision(target, observation, observation, 80)?.action,
  "replace",
);
assert.equal(
  stalledDecision(target, { ...observation, speed: 100 }, observation, 80),
  null,
);
assert.equal(
  stalledDecision(
    target,
    { ...observation, progress: 0.95, availability: 0.95 },
    observation,
    30,
  ),
  null,
);
assert.ok(
  releaseScore({
    seeders: 10,
    size: 300e6,
    trackCount: 12,
    quality: "FLAC",
    sourceScore: 0.8,
    importRate: 0.8,
  }) >
    releaseScore({
      seeders: 1,
      size: 1e9,
      trackCount: 12,
      quality: "FLAC",
      sourceScore: 0.2,
      importRate: 0.2,
    }),
);
assert.equal(
  releaseScore({
    seeders: 20,
    size: 100e6,
    trackCount: 10,
    quality: "AAC-256",
    sourceScore: 1,
    importRate: 1,
  }),
  -Infinity,
);
const auditHour = 3_600_000,
  now = Date.now(),
  recent = {
    ...target,
    id: 2,
    origin: "migration" as const,
    created_at: new Date(now - auditHour).toISOString(),
    last_search_at: null,
  },
  user = {
    ...target,
    id: 3,
    origin: "user" as const,
    created_at: new Date(now - 7 * 24 * auditHour).toISOString(),
    last_search_at: null,
  },
  unsearched = {
    ...target,
    id: 4,
    created_at: new Date(now - 10 * 24 * auditHour).toISOString(),
    last_search_at: null,
  },
  retried = {
    ...target,
    id: 5,
    created_at: new Date(now - 20 * 24 * auditHour).toISOString(),
    last_search_at: new Date(now - 2 * auditHour).toISOString(),
  };
assert.equal(isPriorityTarget(recent, now), true);
assert.equal(isPriorityTarget(retried, now), false);
assert.deepEqual(
  orderSearchTargets([retried, unsearched, recent, user], now).map(
    (item) => item.id,
  ),
  [3, 2, 4, 5],
);
assert.deepEqual(searchBudget({ short: 10, daily: 150, priorityDaily: 0 }), {
  short: 0,
  general: 0,
  priority: 30,
});
assert.deepEqual(searchBudget({ short: 0, daily: 150, priorityDaily: 0 }), {
  short: 10,
  general: 0,
  priority: 30,
});
assert.equal(
  isManagedIncomplete({ state: "missingFiles", progress: 0 }),
  false,
);
assert.equal(isManagedIncomplete({ state: "stalledDL", progress: 0.5 }), true);
assert.equal(isManagedIncomplete({ state: "queuedUP", progress: 1 }), false);
console.log(
  "Acquisition policy audit passed: mode, stalls, search priority, quotas, managed downloads, throughput scoring, and quality exclusions.",
);
