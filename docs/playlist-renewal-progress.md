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
- Read-only full-pipeline replays exposed two gaps absent from the synthetic
  fixtures: the model promoted ordinary mood/context preferences into hard
  requirements, and sometimes failed artist/album distribution arithmetic after
  a repair. Added exact user-quote checks for mandatory mood/context claims,
  deterministic distribution repair within the same inspected candidate set,
  and an application-selected feasible plan as a distribution fallback. Hard
  musical requirements and unseen IDs remain errors, with one model repair.
  The second six-scenario replay passed 6/6, zero independent violations and
  no publications (`evaluation/initial-six-v2.json`). It does not cover chat
  correction stages or satisfy the 72-run gate.
- Actual replay latency identified repeated tool exploration (up to 147,386
  tokens) and verbose reranking documents. Candidates are now supplied directly,
  the first validation stage advertises only its permitted tool, and successful
  validation moves immediately to structured output. This also works around
  the deployed custom template ignoring named `tool_choice`. Reranking uses
  shorter musical descriptions. A 24-case initial replay is in progress; the
  first case improved from 69.4 to 49.2 seconds, including compilation/retrieval.
- Added the missing evidence lookup index and bounded startup WAL-transition
  retries after concurrent-migration testing exposed a race. Native snapshots
  now retain full collaborative credits, paths and disc/track positions;
  additive migration 22 invalidates only the older identity cache version.
  Exact owner-visible paths resolve edition collisions; contradictory paths
  cannot be rescued by a stale mapping. Native IDs associated with conflicting
  recording identities are rejected. Single-artist requests now select one
  eligible artist group and report a shortage instead of padding across artists.
- Latest full checkpoint: 212/212 tests, TypeScript and production build passed
  before the final single-artist and native-identity regression additions. Those
  additions passed targeted tests; repeat the full checks before committing.
  Production remains unchanged, new pipeline flag off; no nightly rollout or
  three-night observation has begun.
- Follow-up implementation now uses the same bounded interpretation/retrieval/
  selection path for managed interactive chat and nightly chat. Real corrections
  can supersede earlier requirements; nightly work cannot weaken the latest
  saved full intent, pins or position locks. Interpretation also represents
  single-artist scope, album-level recent-play exclusions, negative dynamics,
  and explicit Journey arcs. Independent evaluation expectations are separate
  from generated intents and production scoring; the runner now includes actual
  correction messages and subsequent nightly generations in the private copy.
- The wider initial replay exposed an invented-style false shortage
  (`calm_electronic` / `japanese_jazz` composites). Interpretation now receives
  bounded library vocabulary and separates mood, geography and style. Another
  piano failure was an overly literal evaluation assertion excluding
  `electric_piano`; the independent oracle now recognises piano variants.
  Preserve the exploratory report and distinguish these two causes.
- Evidence view v2 treats empty fields as unknown, preserves explicit vocal/year
  overrides, surfaces conflicting original dates, and does not use compilation
  release-group dates as original recording dates. These are computed evidence
  changes, not blanket reclassification or tag writes.
- Live free-provider probe: ListenBrainz artist radio returned HTTP 200 in
  491 ms, grouped recording MBIDs and 29 remaining requests. Discovery now checks
  release/artist/recording bindings, prefers official artist albums over
  compilations, validates provider payloads before caching, and requires musical
  fit separately from identity before acquisition. Exact editorial style quotes
  support claims; a related artist with unknown exact style is labelled adjacent.
  Full end-to-end provider resolution/acquisition evidence is still outstanding.
- Local embedding indexing exposed a real batch-size problem: the existing
  four-thread single-slot service processes descriptions sequentially, so 32
  texts exceeded the 12-second deadline. Eight-document batches now succeed:
  128 vectors committed in 70.6 seconds. The private copy's fixed-library index
  is building with chat priority and at most 128 tracks per minute; the original
  failed benchmark is preserved. Final replays must use a stable completed index.
- Current checkpoint: full suite 230/230 and production/worker build passed
  (`/private/tmp/curator-renewal-v7-{tests,build}.log`). Final TypeScript check is
  sequential after build because both access Next's generated type files.
  No push, deployment, new production migrations or feature enablement yet.
- Full initial 24-case exploratory replay completed at
  `evaluation/initial-24-v3-exploratory.json`: 20/24 passed the then-current
  assertions. This is not the acceptance gate. Two false shortages came from
  invented styles; the single-artist scenario needs collection-level sufficiency,
  and the piano assertion incorrectly rejected electric piano. The newer oracle
  distinguishes those cases and also normalises hyphens in embedded Trip-Hop
  tags. Preserve the original failures; do not retroactively call the old run a
  pass. The fixed “forgotten favourites” rubric accepts observed enjoyment or a
  favourite as stated in the goal; “Only my favourites” remains a strict filter.
- Live source proof exposed a substantive relevance bug: the old seed selector
  treated broad electronic as an alternative to the specific techno lanes and
  chose Imagine Dragons, leading to unrelated pop releases. No acquisitions
  were submitted. Specific lanes now gate seed eligibility, and each artist
  uses its best matching track. Similarity claims carry the matched seed styles;
  clearly unrelated release genres are rejected. Sparse coverage tries other
  relevant seeds within caps. Original evidence is retained in
  `discovery/live-provider-proof-v1-wrong-seed.json`.
- Follow-up source proof resolved Groove Armada’s “Latenight Mixes, Part 2” from
  a style-matching Leftfield seed as an explicitly adjacent recommendation.
  A genuine MusicBrainz 503 stopped further work and set the live shared
  cooldown; it was honoured. Tests also caught a legitimate nullable MusicBrainz
  release status incorrectly poisoning a whole recording response; fixed and
  regression-tested. Provider proof has used 19 of its separately capped 20
  uncached requests today, coordinated with production’s existing rate state.
  A replenishing ten-candidate production pool is still unproven.
- Additive migration 23 separates recommendation evidence per owner/playlist
  from shared canonical release facts. A second owner can no longer overwrite
  the first owner’s seed/provenance. Unique legacy associations migrate; ambiguous
  shared evidence is preserved in a review table instead of copied to listeners.
  Unverified legacy evidence neither fills the verified pool nor permits new
  automatic acquisition. Cross-owner and migration regressions pass.
- Evidence view v3 includes the taxonomy correction for electronic substyles;
  broad genre matching retains specific style distinctions. Central style fit
  is enforced even when another factual requirement also matches. Embedding
  backlog tracking now checks evidence version and source freshness, rather
  than declaring success from vector row count alone; second-resolution source
  timestamps cannot hide an edit within the embedding’s timestamp second.
- Latest checkpoint: 234/234 full tests and production/worker build passed
  (`/private/tmp/curator-renewal-v8-{tests,build}.log`). TypeScript is checked
  after the build. No production code/migration/playlist deployment yet.
- Next: finish/preserve the current real correction/nightly replay; its
  Trip-Hop assertion failures are oracle punctuation mismatches, while actual
  selections all carried trip-hop evidence. Restart the private embedding
  evaluator with evidence v3 and the new backlog guard (the currently running
  evaluator is older). Complete the stable-index 24×3 gate, actual-library
  fourteen-night simulation and independent 40-case quality comparison.
- Additional required review before rollout: the current long retry backoffs
  need dependency-recovery detection to guarantee the stated 30-minute recovery;
  recording-key upgrades and file deletion must not erase recent exposure or
  removal cooldown. Provider tag-radio fallback would improve sparse artist
  coverage. None of these should be hidden by calling the goal complete.
- Closer inspection corrected the earlier Trip-Hop diagnosis: punctuation was
  only part of it. “You Wish” qualified through a scene association while its
  track style fields said downtempo/chillout. Track genre/style now establishes
  the centre; scene associations receive only a small ranking bonus. The new
  real creation/correction/nightly replay passed 3/3 with independent checks
  (`evaluation/strict-trip-hop-v5.json`). The old outputs remain failures.
- Evidence view v4 preserves a specific original genre tag when a model uses its
  broader parent genre; parent-category equivalence cannot prove a tag mirrors
  the classifier. The fixed-library index is now running with this version and
  accurate backlog detection at `embeddings-v4` in the private pod directory.
  Wait for zero backlog before final acceptance replays. No blanket profile or
  tag rewriting occurred. Two earlier exact-output oracle rechecks remain
  archived; neither replaces a live rerun.
- Named-song inspection exposed another real gap: the earlier Green Day
  correction saved “Basket Case first” without enforcing it immediately when
  absent from the current selection. Intent now carries quoted named requests;
  application code resolves owner-visible eligible native IDs, pins and positions
  before selection. An independent opener check catches the old omission without
  reducing its sufficiency denominator. The new real three-stage replay passed
  3/3 (`evaluation/named-opener-v6.json`), including the immediate correction.
  Requests cannot invent IDs or bypass newer exclusions. Newer playlist edits
  also fence an in-flight interactive reply before it commits conversation state.
- Managed publication now revalidates exact size, current metadata, duplicate
  identities, pins and positions. Current owner feedback is application-owned
  intent state, rebuilt on each generation so expired snoozes are not frozen
  into conversation intent. Nightly chat saves the full resolved intent along
  with its selection, preserving the real messages and clearing old shortages.
- Journey ordering now globally assigns selected energy levels to the requested
  arc, reserving a calm landing rather than spending all quiet tracks early.
  Equal-energy choices still favour artist spacing; pins retain priority.
  Festival-EDM exclusions recognise canonical big-room labels without excluding
  all house. Evaluation now also records uncertainty in soft fields it used.
- Free ListenBrainz tag radio is implemented with the documented OR semantics,
  sharing the artist-radio limiter/cache/cooldown. A live ten-request proof
  resolved three fitting catalogue albums (Drexciya, The Japanese Popstars,
  Moby). OR queries do not assert every requested tag describes a recording.
  Proof traffic is cumulatively capped at 40 (29 used so far), below the goal's
  global 100-request discovery budget. Source seed selection now uses the same
  evidence view and user overrides as selection. Fresh research can verify a
  legacy association without dropping its existing acquisition state.
- Native owner preflight confirms the currently enabled playlists belong to
  busykoala; its complete snapshot has 16,359 songs, 1,952 played songs and two
  favourites. The native favourite filter returns the same two with implicit
  and explicit owner context. Counts only are reported; histories remain local.
- Current full checkpoint: 247/247 tests and production/worker build passed
  (`/private/tmp/curator-renewal-v10-{tests,build}.log`), followed by TypeScript.
  The full 72 initial replays, independent 40-case improvement gate, real-library
  simulation, recovery/cooldown review and staged production nights are still
  outstanding. Production image and pipeline mode remain unchanged.
- Publication recovery now follows owner/playlist journal identities across
  configuration revisions, preserving an uncertain create rather than creating
  a duplicate after an edit. Additive migration 24 records the previous remote
  name so failed renames restore both name and songs. Lost mutation ownership
  fences rollback as well as confirmation. Native playlist inventory follows
  pagination and rejects incomplete, repeated or changing results before a
  create. Ten focused publication/inventory regressions and TypeScript pass.
  This is pre-deployment evidence; production remains unchanged.
- Dependency recovery now checks connectivity failures independently of the
  persisted exponential retry, at most every five minutes. A successful native
  or actual structured-model probe wakes the affected job without erasing its
  last failure. Authentication, quotas, shortages and invalid selections are
  excluded. The model's Retry-After deadline is persisted across processes so
  recovery checks cannot bypass it. Fourteen focused recovery/client tests and
  TypeScript pass. No live outage or production rollout has been claimed.
- Additive migration 25 preserves owner-scoped recording exposure independently
  of files, playlist runs and playlist deletion. Existing rows are copied;
  compatibility triggers retain subsequent insert/removal events. Alias lookup
  keeps cooldowns through recording-ID verification and reimport, without
  double-counting the same event. Owner deletion still removes private history.
- Selection groups now deduplicate verified/unverified physical copies without
  changing either copy's factual identity/provenance. Distinct verified recording
  IDs and live/remix/acoustic versions survive; an unverified copy ambiguous
  between multiple verified recordings is withheld. Pins resolve by current file
  identity even after a grouping-key upgrade.
- Full checkpoint: 260/260 tests and production/worker build passed
  (`/private/tmp/curator-renewal-v11-{tests,build}.log`), followed by TypeScript.
  A subsequently added legacy exposure migration test also passes. The metadata
  evidence version/content is unchanged, preserving the running vector index.
- Discovery now classifies a small, documented set of neighbouring local styles
  from actual track genre/style evidence, with explicit provenance as Curator's
  product policy rather than an external recommendation claim. It reserves the
  agreed 30% among additions and reports unavailable adjacent slots. Every hard
  style filter/exclusion remains enforced. Compiler v6 expresses ordinary
  Discovery preferences as a centre, preserving explicit “only” restrictions.
  The independent Discovery oracle now recognises the agreed neighbouring styles
  rather than incorrectly requiring every Discovery track to be in the centre.
  Tests prove the 70/30 balance, strict-filter precedence and visible shortage.
- The source proof has resolved only one stored private recommendation so far;
  another real MusicBrainz 503 activated its shared five-minute cooldown.
  `discovery/live-pool-v2-partial.json` preserves this incomplete result. The
  cumulative proof cap is now 60 requests, within the global 100-request limit;
  no production recommendation or acquisition was created. Tag radio requests
  at most twelve recordings and stops at ten verified release groups.
- The original 120-track sample mistook curly punctuation for non-Latin names.
  The corrected deterministic sample uses Unicode letters/scripts and includes
  all seven available non-Latin-labelled tracks (one may be an encoding issue).
  Its complete embedded tags are preserved in `metadata-audit-v2/input.json`,
  sample hash bf1dabe136176032c56781627f14c73ddd3d9fd5dd919f3e7a332c049628c9be.
  The original baseline/report remains intact. The corrected evidence audit is
  still provenance/uncertainty analysis, not verification of every musical claim.
- Added the real-library fourteen-night simulation runner. It consumes a live
  replay's exact compiled intent and listener hash, evolves hypothetical exposure
  only, and reports retained shortages, feasible rotation, locks and cooldown
  violations. It has not yet run against the final stable-index replay.
