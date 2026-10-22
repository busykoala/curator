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
