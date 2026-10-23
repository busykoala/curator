# Playlist renewal rollout and observation

The [goal](playlist-renewal-goal.md) and [progress record](playlist-renewal-progress.md)
are authoritative. Passing local tests is not completion: the unpublished nightly
comparison, Discovery canary, and three healthy production nights are separate gates.

## Inputs and rollback

- Keep `delivery/playlist-renewal/` private and ignored by Git. It contains the
  frozen 16,344-track baseline, owner listening snapshots and evaluation reports.
- Never promote the private evaluation database to production. It contains
  synthetic definitions, controls and test history. Transfer only the separately
  exported vector artifact; the importer verifies each current description hash,
  model version, dimensions and evidence version. Changed tracks must be skipped.
- The pre-renewal production backup is encrypted in
  `/app/data/playlist-renewal-private/`. Authenticated decryption and SQLite
  `quick_check` passed. The real-copy schema 12→27 rehearsal preserved every
  existing definition, saved run, song ordering, tag/profile and credential hash,
  and passed a second migration run. Preserve the encrypted backup and tag file.
- Preserve the previous deployed image digest
  `672938b532fde6553c3310851dc7e794aa3c8cff05b51ee51f2bb8fe19d5c3e8` and previous
  Helm revision 90. Switch the pipeline off before application rollback. Additive
  tables and previous selections remain available; do not overwrite current
  listening history or delete native playlists as a routine rollback.

## Pre-deployment gates

1. Require passing unit/integration tests, TypeScript, production/worker build,
   migration rehearsal and acquisition audits. Verify CI and container publication
   for the exact application commit; inspect the registry revision and amd64
   manifest rather than trusting the mutable `latest` tag.
2. Finish all 24 live scenarios three times and all chat correction/nightly stages.
   Retain failed/interrupted reports. Require the stated ≥95% valid-selection gate
   where sufficient music exists, with no hard-constraint publication bypass.
3. Complete the 40-case comparison against the frozen deployed selector and the
   full real-library 14-night simulation. The latter supports
   `PLAYLIST_SIMULATION_WATCH=true`; it processes each scenario/stage once while
   the fixed replay grows. Its final report must have `completeInput=true` and no
   violations. A partial simulation is not the full gate.
4. Preserve the private database, reports and operator bundles before replacing
   the pod: `/tmp` disappears. Use SQLite backup, not a live file copy, for the
   private database. Keep it inside the existing owner-only private directory.

## Deployment and staged activation

1. Update both `../server/deploy/music-server/values.yaml` and
   `../server/inventory/group_vars/all.yml` to the final verified digest. Stage only
   the music chart/version and those pins; preserve unrelated inference work.
2. Deploy the pinned Helm release atomically with readiness checks. Verify the
   actual pod image, schema 27, health/readiness, and all supervised workers,
   including `playlist-refresh`. Check the rest of the music stack and chart test.
   The database flag remains `off` during this step.
3. Upload the bundled operator tools under an explicitly named `/tmp` directory
   with a `node_modules` symlink to `/app/node_modules`. The TypeScript source
   tools are not directly runnable in the production standalone image.
4. Apply the same identity-bound source correction for “Song of the Century”
   using the explicit production review mode, then import matching vectors. This
   changes evidence only, preserving raw tags, profiles and user overrides.
5. The rollout operator requires `PLAYLIST_ROLLOUT_APPLY=true`, the exact expected
   previous mode and production schema 27. `status` uses a read-only connection.
   Record the build and enabled playlist IDs at each transition. Preserve all
   enablement choices: currently 1–13 are enabled; 14–16 are disabled.
6. Set `shadow`. One catch-up comparison per enabled playlist is expected when
   activating after downtime. It cannot publish. A catch-up outside today's
   scheduled window does not count as the required nightly comparison.
7. Observe one actual 04:30 Europe/Zurich cycle. Require completed unpublished
   proposals, correct counts/constraints, and retained user selections. Keep the
   legacy and new receipts distinct. Investigate any legacy lock collision rather
   than claiming an unpublished proposal was a successful publication.
8. After that gate passes, set canary IDs to `6` and mode to `canary`. Create one
   idempotent durable canary request through the application function: the legacy
   pipeline may already have refreshed today, so scheduling alone may skip it.
   Verify the owner-scoped native ordering and saved-intent receipt before widening.
9. Set `enabled` after the canary checks pass. Research, acquisition and
   publication remain independent. Verify the real Discovery pool replenishes,
   preserves dismissed rows and stalled downloads, and honours its daily caps.

## Nightly evidence

Run the bundled `observe-playlist-night.mjs` with an explicit Zurich scheduled
`PLAYLIST_OBSERVER_DATE` and `PLAYLIST_OBSERVER_KIND=shadow|nightly`. It opens the
application database read-only, performs owner-authenticated native GETs and
writes a private JSON report. It never starts the app, migrates, infers, acquires
or publishes. Credentials remain in memory and are absent from reports.

Check shortly after 04:30 and again when jobs finish. Require each enabled
playlist to have a new-pipeline publication receipt by 06:00, the requested song
count, valid pins/positions, ordered native/local ID equality, no duplicate live
native identity, and operational budgets within their limits. Retain intermediate
failure reports too. Do not count legacy publications or drafts as new-pipeline
successes. If widening happens after today's legacy run, begin the three-night
count on the next real full cycle unless every playlist has a qualifying receipt.

Scheduling remains 04:30 local through DST: 24 October 2026 is 02:30 UTC;
25 October is 03:30 UTC. Use the scheduling helper, not a fixed UTC offset.
Wait between checks; never advance stored dates or replay simulated nights as
production evidence. If dependencies fail, record availability/restoration times
and confirm catch-up within 30 minutes. Do not clear errors or weaken constraints
to make the report green. The goal stays active until all completion gates pass.

The current rollout operator is also preserved at
`/app/data/playlist-renewal-private/rollout-admin-current.mjs`. It schedules due
work before requesting the canary refresh, so the request joins an already-due
nightly job; if today was already published, it creates one deliberate manual
refresh. This avoids a redundant manual/nightly pair. Use this current operator
rather than the earlier deployment-archive copy after restoring temporary tools.
