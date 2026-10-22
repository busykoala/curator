# Playlist renewal execution record

The authoritative requirements are in [the goal](playlist-renewal-goal.md).
Private production snapshots, fixed evaluation inputs and reports belong under
`delivery/playlist-renewal/` (ignored by Git). Never store credentials there.

## Ordered packages

1. [x] A — Read-only audit, immutable baseline, fixed 120-track metadata audit,
   six-type intent fixtures and 40-case musical-fit rubric.
2. [ ] B — Durable independent refresh worker, catch-up, retries, shared mutation
   leases, revision fencing and recoverable verified publication.
3. [ ] C — Owner/playlist-bound discovery, non-blocking publication, fair pools,
   acquisition caps, stalled recommendation deferral and representative songs.
4. [ ] D — Independent cached/rate-limited discovery adapters and evidence.
5. [ ] E — Field evidence, canonical identities, metadata audit/targeted repairs,
   complete owner-specific listening snapshots with stale-data fallback.
6. [ ] F — Intent-aware six-type selection, exposure, rotation and safe shortages.
7. [ ] G — Local semantic retrieval/reranking, bounded tools, validation/repair,
   interactive priority and correction-preserving nightly chat refresh.
8. [ ] Interfaces/UI — Owner-scoped status, retry/dismiss and selection evidence.
9. [ ] Verification — Full tests/build/migrations; 24 scenarios × 3 live replays;
   14-night simulation; 40-case rubric (≥80%, +15 percentage points).
10. [ ] Rollout — Feature-flagged deployment, one unpublished nightly comparison,
    Discovery canary, wider enablement, three consecutive verified live nights.

Do not mark an item complete without a command/report or runtime evidence. An
unverified criterion is outstanding, including subjective quality gates. Preserve
existing enablement, saved selections, acquisition protections and unrelated
changes in the infrastructure repository. Update this record at each handoff.

## Work log

- 2026-10-22: Read the complete attached objective and verified a clean Curator
  worktree. Previous goal turn was interrupted before implementation; no rollout
  or nightly observation has started. Beginning package A.
- 2026-10-22: Package A baseline captured in
  `delivery/playlist-renewal/baseline/production.json` at 18:58:31 UTC: 16
  playlists, 16,344 tracks, deterministic 120-track audit sample. The manifest
  records SHA-256 and fixture hash
  `4509e42e1e9569eba924ae0961427b1be5d28fa6dce615d24ed081078fe9d147`.
  Added the read-only `scripts/audit-playlists.cjs` and fixed 24 intent / 40
  reference-rubric cases. Remote publication and musical-constraint validation
  are explicitly unverified by this baseline, rather than counted as passes.
- 2026-10-22: Package B implementation added a supervised independent worker,
  durable jobs/checkpoints, four retry delays, auth waits, per-playlist mutation
  leases, revision fencing, and a recoverable native-publication journal. The
  feature flag remains `off`; production has not changed. Validation: full
  `npm test` 131/131, `npx tsc --noEmit`, `npm run build`; additional lost-create /
  lost-rename response and rollback checks passed. Runtime/rollout evidence is
  still outstanding. Package A committed as `c61d1a2`.
- 2026-10-22: Discovery implementation now stores shared canonical releases and
  owner-specific recommendations, removes the publication/download dependency,
  defers stalled recommendations without deleting payloads, and reserves capped
  acquisition admissions with lost-receipt reconciliation. Added provider
  caching, budgets/cooldowns, ListenBrainz/MB identity, editorial/official pages
  and optional Last.fm adapters. Legacy identity/output exports remain for
  existing audits. Package C/D runtime verification, provider end-to-end checks,
  relevance/representative-track integration, and pool replenishment after
  exposure are still outstanding; do not treat passing unit tests as completion.
- 2026-10-22: Supplemental baseline
  `baseline/production-current-selections.json` captures frozen/disabled mixes
  outside the seven-day report window (including Discovery's saved 24 tracks
  and all three chat results). Fixed snapshot hash:
  `d6089f9094132ff934521aad385dda168da2f75c7897b10b3d62dc366d5ba228`.
  Preserve both original and supplemental snapshots. Full regression suite after
  C/D passed; next work is source integration verification and package E.
- 2026-10-22: Packages C/D committed as `7c003bd`; 144 full tests and production
  build passed. No code has been pushed or deployed yet. Worker mode in
  production remains the existing legacy pipeline.
- 2026-10-22: Package E foundation now includes complete owner-specific native
  pagination, stable song IDs, per-track plays/favourites/ratings, cached last
  good snapshots, and explicit incomplete/stale flags. Live read-only probes
  verified different pages and real last-played timestamps on played songs;
  native count was 16,359 (the fixed Curator baseline remains 16,344).
  Added canonical field/value aliases, a versioned field-evidence view/cache,
  recording-aware keys, separate original/edition years, conflict handling,
  and provenance in newly classified profiles. Completed the fixed 120-track
  provenance audit at `metadata-audit/report.json`: zero internal conflicts,
  3,214 model-inference fields, 263 unknown and 123 embedded fields (including
  edition years, which do not establish original recording years).
  This does not prove musical accuracy. Targeted external fact gathering,
  the 100-track/day review queue, and selection integration remain outstanding.
- Package E foundation validation: full suite 154/154, TypeScript and
  production/worker build passed. Evidence/date/recording-identity checks
  distinguish syntax-valid embedded MBIDs from independently verified recording
  identities. Numeric analyzer features do not establish vocals,
  instrumentation, or categorical musical intensity.

## Next continuation

- Package F now has cached configuration/description/chat intent compilation,
  immutable configured and saved-chat requirements, six selection policies,
  native identities visible to the owner, recording deduplication, owner-scoped
  exposure, controlled rotation and safe shortage publication checks. A fixed
  14-night simulation passes size/30% rotation/pins/positions/cooldown checks;
  integration tests cover same-name owners, no preview exposure, stale evidence
  and saved chat corrections. Nightly chat publication updates its selection
  without adding conversational turns. Live musical-fit verification is pending.
- Package G transport now caps a request at four minutes, six tool rounds and
  12 calls, stops identical calls, honours Retry-After and exposes every HTTP
  attempt's timing/usage (including failures). Seven transport tests pass.
  Earlier checkpoint: 177 tests and production/worker build passed.
- Read-only live route probes on 2026-10-22 confirmed the current `curator`
  alias is Qwen3.8-27B (revision `4ca720788d1e01f1bff70c033e0d0028fd02e502`),
  98,304-token context; embedding returned 1,024 dimensions in 46 ms; reranking
  returned ordered scores in 112 ms. No model switch or production mutation.

- Package E's targeted review queue is implemented: at most 100 attempts/day,
  active-selection/new-import priority and chat yielding. Recording facts bind
  title, artist and duration; absent vocal credits never prove instrumental.
  Identity changes invalidate facts, and the import watermark preserves gaps.
  Full tests 159/159, TypeScript and production build passed. External facts and
  actual musical accuracy still require runtime/evaluation verification.
- Package G now connects cached 1,024-dimensional track/query embeddings,
  120-candidate hybrid retrieval, eight-document reranker batches, and at most
  60 visible candidates per generative batch. Initial selections above 60 songs
  use two batches sharing six rounds/12 calls, one repair and a four-minute
  overall deadline. Added five typed read-only tools, code validation and
  evidence-built song explanations. The background embedding fill is capped at
  128 tracks/minute and yields between batches to chat; profiles stay intact.
  Cross-process inference leases serialize background generation and preempt it
  for interactive requests. A regression specifically prevents deadlock when
  queued chat waits for a playlist mutation lease. HTTP attempts, failed-call
  usage/latency and unknown usage are persisted separately. Interactive chat
  uses canonical evidence/recording keys when its playlist is enabled for the
  rollout. Full suite 191/191, TypeScript and production build passed; final
  context-budget/native-identity guards also passed targeted tests/TypeScript.
- Finish operational/status UI, owner-scoped background refresh/retry and
  discovery dismissal; fix existing snapshot staleness to use the stable
  revision hash (implemented, regression passing).
- Run live end-to-end provider checks and model replays. Verify retrieval cache
  model revisions against deployment; inspect actual candidate counts, musical
  fit and timings, and iterate. Synthetic tests and route smoke probes do not
  satisfy the 24×3 replay or 40-case quality gates.
- Operational/UI checkpoint: owner-scoped queued manual refresh, idempotent
  retry receipts, failure/auth/shortage status, discovery dismissal, and
  expandable field/source evidence are implemented. Disabled playlists retain
  no next run even after manual publication. Chat has a refresh-settings link
  and hides musical-property controls; ordinary types now expose their saved
  free-text direction. Discovery copy describes new-to-listener music across
  all release years. Listener-cluster maintenance is independent and retains
  good data on failure, including Unicode identities.
  Full suite 200/200, TypeScript and production/worker build passed; local
  Playwright mobile/desktop audit passed twice (report/screenshots in
  `delivery/playlist-renewal/ui/`). The audit uses isolated fixture accounts
  and no workers/real credentials. A legacy migration fixture falsely marked
  migration 4 complete without its run-owner column; corrected the fixture.
- Live local-model selection-stage smoke passed: 12 eligible distinct
  recordings in 17.7 seconds. Inspection found concentration in one artist.
  A stricter trial revealed that the fixed narrow-style pool has only five
  artists and cannot fill 12 under the original artist/album preferences.
  Selection now calculates and records the smallest feasible relaxation instead
  of dropping both preferences. The revised live smoke passed in 19.3 seconds,
  without a repair (51,592 total tokens across calls). Preserved original and
  failed trial evidence under `delivery/playlist-renewal/live-smoke/`.
  This smoke does NOT establish native playability, listening novelty, compiled
  intent accuracy, the full 72 replays or musical-rubric quality.
- A protected temporary production SQLite backup (2,121,740,288 bytes) exists
  inside the current Curator pod at
  `/tmp/curator-renewal-eval-20261022.sqlite` for isolated live evaluations.
  Production database/schema/flags, deployments and playlists are unchanged.
  Use that copy, frozen baseline metadata and actual owner history/native IDs
  for the next evaluation; enforce the temporary-path guard before migrations.
- Before enabling C/D, recheck two lifecycle edges spotted during review:
  genuinely active transfer counts currently count every unfinished torrent,
  including old paused/stalled transfers; maintenance's sequential catch block
  can suppress research when acquisition dependencies fail. Also protect
  admission inventory against overlapping worker processes/rollouts, not only
  individual SQL reservations. Add regression and live evidence for these.
- Follow-up lifecycle fixes are implemented: paused/finished/partial-seeding
  transfers and >48-hour non-progressing transfers do not exhaust active slots;
  current byte flow and recent commitments still count conservatively. A shared
  leased admission inventory prevents overlapping workers using stale counts,
  including lost/expired worker ownership. Research now continues independently
  when acquisition dependencies fail. Four new regressions pass; full suite
  204/204 and production build passed. Live provider/inventory evidence remains
  outstanding before C/D can be considered verified.
- Finish owner-scoped status/retry/dismiss/evidence UI and perform all stated
  live evaluations, simulations and quality gates. Current passing tests prove
  foundations only. Provider adapters still need live end-to-end validation.
- Deploy/observe only after the remaining packages pass. Preserve the original
  rollout: unpublished nightly comparison, Discovery canary, then three verified
  full nights. Goal completion remains unproven.
