import assert from "node:assert/strict";
import {
  controllerMode,
  balancedSearchTargets,
  isManagedIncomplete,
  isStaleOrphan,
  isPriorityTarget,
  orderSearchTargets,
  releaseScore,
  searchBudget,
  shouldUseFallback,
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
assert.equal(
  isStaleOrphan({ state: "missingFiles", added_on: (now - 25 * auditHour) / 1_000 }, false, now),
  true,
);
assert.equal(
  isStaleOrphan({ state: "missingFiles", added_on: (now - 25 * auditHour) / 1_000 }, true, now),
  false,
);
console.log(
  "Acquisition policy audit passed: mode, stalls, search priority, quotas, managed downloads, throughput scoring, and quality exclusions.",
);

assert.equal(searchBudget({short: 0, daily: 150, priorityDaily: 0}, true).general, 450);
assert.equal(searchBudget({short: 10, daily: 600, priorityDaily: 30}, true).short, 0);
assert.equal(searchBudget({short: 0, daily: 601, priorityDaily: 30}, true).general, 0);
assert.equal(shouldUseFallback(target, 2), true);
assert.equal(shouldUseFallback(target, 1), false);
assert.equal(shouldUseFallback(recent, 3), false);
assert.equal(stalledDecision(target, {...observation, progress: 0.5758746, availability: 0.576}, observation, 80)?.action, "replace");
const balanced = balancedSearchTargets([
  { ...unsearched, id: 10, search_count: 0 },
  { ...unsearched, id: 11, search_count: 0 },
  { ...retried, id: 12, search_count: 1 },
  { ...retried, id: 13, search_count: 2 },
], 4, now);
assert.equal(balanced.length, 4);
assert.deepEqual(balanced.slice(0, 2).map(item => item.id), [13, 12]);

// Retry timestamps are ISO strings, while SQLite CURRENT_TIMESTAMP uses a space.
import Database from "better-sqlite3";
const sqlite = new Database(":memory:");
assert.equal((sqlite.prepare("SELECT datetime(?) <= datetime(?) AS due").get("2026-09-05T02:25:16.707Z", "2026-09-05 08:40:50") as {due: number}).due, 1);
sqlite.close();

import { ubuntuTorrentFromHtml } from "../src/features/acquisition/qbittorrent";
assert.equal(ubuntuTorrentFromHtml('<a href="ubuntu-24.04.3-desktop-amd64.iso.torrent"></a><a href="ubuntu-24.04.4-live-server-amd64.iso.torrent"></a><a href="ubuntu-24.04.10-desktop-amd64.iso.torrent"></a>', 'https://releases.ubuntu.com/24.04/'), 'https://releases.ubuntu.com/24.04/ubuntu-24.04.10-desktop-amd64.iso.torrent');
assert.throws(() => ubuntuTorrentFromHtml('<a href="https://example.org/test.torrent">', 'https://releases.ubuntu.com/24.04/'));
