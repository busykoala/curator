# Playlist renewal execution record

The authoritative requirements are in [the goal](playlist-renewal-goal.md).
Private production snapshots, fixed evaluation inputs and reports belong under
`delivery/playlist-renewal/` (ignored by Git). Never store credentials there.

## Ordered packages

1. [x] A — Read-only audit, immutable baseline, fixed 120-track metadata audit,
   six-type intent fixtures and 40-case musical-fit rubric.
2. [x] B — Durable independent refresh worker, catch-up, retries, shared mutation
   leases, revision fencing and recoverable verified publication.
3. [x] C — Owner/playlist-bound discovery, non-blocking publication, fair pools,
   acquisition caps, stalled recommendation deferral and representative songs.
4. [x] D — Independent cached/rate-limited discovery adapters and evidence.
5. [x] E — Field evidence, canonical identities, metadata audit/targeted repairs,
   complete owner-specific listening snapshots with stale-data fallback.
6. [x] F — Intent-aware six-type selection, exposure, rotation and safe shortages.
7. [x] G — Local semantic retrieval/reranking, bounded tools, validation/repair,
   interactive priority and correction-preserving nightly chat refresh.
8. [x] Interfaces/UI — Owner-scoped status, retry/dismiss and selection evidence.
9. [x] Verification — Full tests/build/migrations; 24 scenarios × 3 live replays;
   14-night simulation; 40-case rubric (≥80%, +15 percentage points).
10. [x] Rollout — Feature-flagged deployment, thirteen unpublished comparisons,
    Discovery canary, wider enablement, and triggered native verification under
    the user amendment below. Actual overnight cycles were not observed.
11. [ ] Production Discovery pool — Verify ten current, evidenced candidates
    with source and acquisition budgets intact. Latest live count: five;
    MusicBrainz still returns HTTP 503. Implementation delivery above does not
    close this operational requirement or mean the full goal is complete.

Checked packages describe delivered implementation and its recorded tests/live
checks. The production research pool is currently below its steady-state target
during an external MusicBrainz outage; see the closeout limitations below. A
checked implementation package does not assert that this provider has recovered.

Do not mark an item complete without a command/report or runtime evidence. An
unverified criterion is outstanding, including subjective quality gates. Preserve
existing enablement, saved selections, acquisition protections and unrelated
changes in the infrastructure repository. Update this record at each handoff.

## Execution amendment — 23 October 2026

The user explicitly requested: “you can trigger the job and then finish.” This
replaces the waiting period for an actual shadow night and three observed nights
with immediate, deliberately triggered production verification. It does not
relax ownership, identity, musical constraints, publication checks or budgets.
The earlier daytime shadow comparison covers all thirteen enabled playlists;
the real Discovery canary and the remaining enabled playlists must now publish
through the durable production worker and pass native verification. Scheduled
overnight cycles remain unobserved and must not be reported as completed nights.
The original goal is preserved without rewriting its historical requirements.

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
- Primary artist credits exposed a factual error in the fixed piano reference:
  Sonny Rollins's “St. Thomas” has Tommy Flanagan on piano. Before running the
  quality comparison, replaced that negative example with “I'm an Old Cowhand”
  from the explicitly piano-less Way Out West trio. The criterion is unchanged;
  original reference and primary URLs are retained in evaluation-cases.ts.
- Started the controlled forty-case musical-fit comparison (`rubric-v1`) against
  live local intent compilation and the exact deployed 4177f1d selector/ordering
  functions extracted with frozen clock and documented source/artifact hashes.
  Both receive identical controls and reference attributes. Synthetic reference
  IDs stay in memory and can never reach native publication. This measures fit
  conditional on the curated reference metadata; it does not establish that
  corresponding owned files exist or that all library profiles are accurate.
  The real-library 24x3 replay and production quality checks remain separate.
  A startup harness error (missing crypto import) was fixed before model cases
  ran; no result was counted from that failed invocation.
- The first complete controlled rubric passed 35/40 (87.5%) versus 21/40
  (52.5%) for the frozen deployed selector, a +35-point improvement. The second
  passed 36/40 (90%, +37.5 points). Both originals, including failures, are saved
  as `evaluation/rubric-v{1,2}-controlled.json`. These conditional fixture results
  exceed the numeric gate; they do not establish actual library metadata truth.
- Inspected failures rather than changing the frozen fixtures: the compiler
  invented artist-associated style gates, extra instruments/tempo-feel and
  recording-type requirements not requested by the listener. Compiler v8 adds
  minimal complete examples and preserves the actual period/BPM instructions.
  Speech exclusions normalise to vocal evidence, preserving instrumental
  interludes and unrelated live restrictions. A third unchanged-fixture run is
  active; the real stable-index replay is still outstanding.
- Inference authentication waits now fingerprint the model connection's actual
  credentials, so a listener login cannot restart a failing model-auth loop.
  Status/UI distinguish this from a revoked Navidrome login. Native auth still
  waits for that owner's renewed credentials.
- Added a vector-only export/import utility for deployment warm-up. Its SQLite
  artifact contains only a manifest and vectors, never an evaluation DB, owner
  histories, settings, credentials or synthetic playlists. Import checks model,
  evidence version, numerical shape and each current track-description hash;
  changed/missing tracks are skipped. It is not yet run against production.
- Latest full checkpoint: 266/266 tests and production/worker build passed
  (`/private/tmp/curator-renewal-v12-{tests,build}.log`), followed by TypeScript.
  One additional inference-status regression passes. Production image and flag
  remain unchanged. No nightly comparison or production-cycle evidence yet.
- Latest controlled rubric (`evaluation/rubric-v3-controlled.json`, compiler v8)
  passes 38/40 (95%) versus 21/40 (52.5%) for the frozen selector: +42.5 points.
  The unchanged fixtures retain two failures. No fixture/native track was
  published, and this result remains conditional on its reference attributes.
- Healthy-provider proof reached eight relevant verified releases while rejecting
  two unrelated releases. The next refill reused cached radio/identity evidence
  and reached ten without another request (`discovery/live-pool-v5-cache-refill.json`).
  Simulating an owner dismissal in the private copy then replenished 9→10 using
  cached evidence with zero network requests (`live-pool-v6-dismissal-refill.json`).
  Production recommendations/downloads are unchanged; total proof traffic is 60.
  Refill query size now follows the deficit, and research stops loading providers
  once the verified active pool reaches ten. Regression tests pass.
- A primary review identifies “Song of the Century” as a cappella, while its
  real 57.773-second studio file's profile invents guitar/bass/drums/piano from
  “typical band setup”. Added a source-review helper and explicit example CLI
  bound to native identity, album, release-group and duration, with a supporting
  track-specific quote. It preserves tags/profiles and user overrides, shares
  the 100-track daily review cap, and invalidates only the affected vector.
  The factual correction has not yet been applied: wait for the old isolated
  embedding process to finish, then apply/repair the single document before the
  final real-library replay. Source-binding/idempotency regressions pass.
- Hash-only cache checks verified 2,815 older vectors still describe exactly the
  current documents; one genuinely changed document remains due. No embedding
  or provider request was issued, no profile was changed, and the real backlog
  fell from 6,792 to 3,953 while new-document embedding continued. This avoids
  spending model work or twenty-plus minutes on unchanged bookkeeping. A test
  proves changed documents are never marked fresh by this utility.

- Added migrations 26–27: unpublished background/shadow proposals are excluded
  from the displayed saved mix, and Discovery recommendations must be validated
  against the playlist's current direction revision before admission or boosts.
  Persisted proposals now carry their exact resolved intent and valid pins/locks;
  a later mutable intent cache cannot weaken publication validation.
- Research reserves its fair cursor and short backoff before compiling intent,
  preventing an invalid description from blocking other playlists. Current-mode
  checks also prevent older queued jobs from escaping a narrowed canary.
- Source pages retain up to 32,000 characters (bounded fetch remains unchanged).
  Editorial style quotes must bind artist and album, exclude negated claims, and
  establish style beyond words in the title. Wrong-album attribution tests pass.
- Added a read-only production-night observer with owner-authenticated native GET
  verification, new-pipeline receipts, requested counts, pins/positions, ordered
  song identity hashes, duplicate-publication checks and operational budgets. Its
  fixture proves it does not modify SQLite and detects accidental shadow writes.
- Checkpoint v14: 277/277 tests, production/worker build, TypeScript and all four
  acquisition audits passed. Two subsequent focused regressions (recording-group
  sufficiency and rollout-mode fencing) pass; they require the next full check.
- Current-direction source proof (`discovery/live-pool-v7-current-direction.json`)
  conservatively validates nine of the earlier ten candidates. Cached results
  use zero network requests and do not restore the dismissed recommendation.
  The remaining slot must be filled by future evidenced research, not a weaker
  genre rule. Production image/flag and recommendations remain unchanged.
- Pushed implementation checkpoint `1bd4237` to main; GitHub CI/container runs
  started. No production rollout or feature enablement has occurred.
- A queued replacement night now retains the previous unresolved error until
  actual success; configuration revision changes still fence obsolete failures.
  Validation v16: 280/280 tests, TypeScript and production/worker build passed.
  The required acquisition audits passed at v14; acquisition code is unchanged.
- Full private index completed: 16,344 vectors, zero backlog. Applied the
  identity-bound “Song of the Century” source review in the private copy: guitar
  eligibility changes true→false with zero tag/profile writes; exactly one
  vector rebuilt in 691 ms. Reports remain under `metadata-audit-v2/` and
  `evaluation/embedding-v{4,5}-*.json`. Exported 16,344 matching vectors to a
  separate vector-only artifact; no owner/history/settings data is included.
- CI for `98ba4ee` passed, and its public image source revision was verified.
  Prepared, but did not deploy, both infrastructure image pins. An encrypted
  pre-migration production backup was restored privately and passed authenticated
  decryption and SQLite quick_check (schema 12, 16 playlists, 16,344 files).
- The full real-library replay exposed Discovery drift: a 12-song example used
  six familiar and six adjacent tracks because album variety was relaxed after
  expanding adjacency. Preserved the interrupted report as
  `evaluation/full-replay-v1-interrupted-discovery-balance.json`. Selection now
  searches the entire adjacent lane and minimally relaxes variety before
  expanding its intended share. Two narrow-pool regression tests pass. Compiler
  v9 also explicitly preserves qualified exclusions such as festival EDM.
  Validation v17: 282/282 tests, TypeScript and production/worker build passed.
  Re-running the fixed rubric, then the complete repeated live replay. No
  production migration, pipeline enablement or new-pipeline nightly evidence yet.
- Rubric v4 remains 38/40 (95%) versus frozen baseline 21/40 (52.5%), +42.5
  points, with unchanged reference cases and the two known failures retained.
- Rehearsed actual production schema 12→27 on a new consistent private copy,
  then repeated migrations idempotently. Hashes of every definition, saved run,
  song ordering, library tag/profile and encrypted credential row are unchanged;
  foreign-key integrity is unchanged and no job/publication was created. The
  rehearsal took 4.6 seconds; report is `baseline/production-migration-rehearsal.json`.
- The next live replay exposed a different Discovery issue: local inference
  promoted ordinary style preferences to hard all-song restrictions, leaving
  zero adjacent additions. Preserved it as
  `evaluation/full-replay-v2-interrupted-invented-style-restriction.json`.
  Compiler v10 now grounds exclusive Discovery style requirements in real user
  clauses, preserving configured hard requirements. Ordinary preferences stay
  in the musical centre and permit the agreed adjacent exploration. Existing
  saved mandatory mood requirements are also preserved on nightly interpretation.
- Added explicit familiar/adjacent counts and target to Discovery evaluation
  receipts. Validation v19: 285/285 tests, TypeScript and production/worker build
  passed; a further focused negated-only direction regression passes. The full
  repeated replay is running against the corrected code (`results-final-v3`).
  Updated compiler requires its final fixed-rubric replay too. Production remains
  unchanged; infrastructure pins currently refer to the earlier 98ba4ee image and
  MUST be updated to the final evaluated build before any deploy/commit there.
- The v10 live Discovery example achieves eight familiar plus four adjacent
  additions, all twelve unheard, with minimal album-variety relaxation (2→2
  tracks per artist, 1→2 per album). Its model still emitted bare `edm`, which
  misses canonical big-room aliases and over-bans otherwise compatible music.
  Preserved that intermediate result as
  `evaluation/full-replay-v3-balance-fixed-before-festival-grounding.json`.
- Compiler v11 grounds bare model EDM exclusions in a literal festival-EDM
  direction and the canonical alias family. A genuine configured/general EDM ban
  is preserved. Two regressions pass. Code is now frozen for the final complete
  replay (`results-final-v4`), followed by the final rubric and real-library
  14-night simulation. v20 validation: 287/287 tests, TypeScript and full build
  passed. Production is unchanged and no required real-night observation has
  occurred yet.
- v4's longer simulation found a real taxonomy bug: TLC “Red Light Special”
  qualified as jazz because `new_jack_swing` matched the generic `swing` root.
  New Jack Swing now maps to R&B before the jazz-family fallback, while ordinary
  swing remains jazz. This is supported by [Teddy Riley's primary interview](https://www.redbullmusicacademy.com/lectures/teddy-riley-lecture/), and a
  regression rejects that R&B style for a strict jazz requirement. No profiles,
  tags or embedding descriptions were reclassified.
- The multilingual calm Discovery case also exposed quota pressure selecting
  non-calm neighbouring soul/rock. Exploration now reserves its share from
  neighbours matching the saved mood/context preferences, preserving central
  music first. Scarcity can still relax these soft preferences explicitly;
  actual hard requirements remain unchanged. Model candidate retrieval preserves
  the feasible controller's context preference and records omitted neighbours.
  The focused live case now passes the unchanged independent oracle
  (`evaluation/context-unicode-correction.json`).
- Kept both original failures (`simulation-v2-failed-new-jack-swing.json`,
  `full-replay-v4-interrupted-adjacent-context.json`). The simulation now stores
  proposed track IDs/genre/style evidence per night and supports incremental
  checkpoints while a fixed replay grows; fixture/listener hashes and evaluation
  start time must stay identical. Full replay v5 and the targeted jazz sequence
  are running. v21: 289/289 tests, TypeScript and production/worker build passed.
  Production is unchanged; prepared infrastructure pins must follow this next
  evaluated build rather than the earlier cc6da9c image.
- The corrected original jazz sequence passes all fourteen nights with the
  independent expectation unchanged (`evaluation/simulation-jazz-corrected.json`).
  Full replay v5 is passing so far; the final simulation watches the same fixed
  replay and now has 42 completed nights without violations. Final model/rubric
  gates and real production nights remain outstanding.
- A UI check found listening freshness was only exposed in the run detail. Added
  owner-scoped saved-history status/date to playlist responses and a concise
  conditional note shared by ordinary/chat views. Fresh publication clears the
  stale label; another owner's state cannot leak. This does not change selection
  inputs or logic. v22: 290/290 tests, TypeScript and production/worker build pass;
  the isolated browser audit also passes with a new mobile stale-history capture.
- Added a rollout runbook. Deployment remains pending. The isolated runtime
  operator refuses mutations without explicit apply, the expected previous mode
  and schema 27; its status mode verified actual production is still schema 12,
  flag off, unpaused, with the original 13 enabled playlists.
- Completed the final fixed 40-case live-model comparison: 38/40 (95%) versus
  21/40 (52.5%) for the exact deployed selector, a 42.5-point improvement.
  The two remaining failures retain honest uncertainty rather than weakening
  factual requirements. Report: `evaluation/rubric-final-v5.json`.
- Chat drafts and direct publication now retain complete selection receipts,
  revalidate the current configuration, and measure changes against the actual
  published mix. Legacy conversations are upgraded from their real saved turns;
  short previews cannot silently publish. Nightly selection-only revisions reuse
  compiled intent. Native authentication waits detect same-second credential
  renewal using a sealed-credential fingerprint. Added seven regressions.
- Preserved the v5 partial replay/simulation before correcting an independent
  reference-check gap: explicit trip-hop, downtempo and synth-pop evidence can
  support a broad Electronic direction, including mixed primary genres. Ambient
  alone, amplified instruments and New Jack Swing remain insufficient. No
  production selection rule or fixed musical-fit gold case changed for this fix.
- Validation v26: 297/297 tests, TypeScript and full production/worker build
  passed. Editorial extraction now records failed-call usage and latency too.
  The complete final live replay is running from `final-v6` with a fresh, complete
  owner snapshot; its matching fourteen-night simulation must finish before
  deployment. No real new-pipeline production night has been observed yet.
- The v6 full replay found a genuine omission in the third focus repeat: the
  model compiled “no dramatic climaxes” into a dynamic-character exclusion only,
  admitting Bonobo “1009” with recorded `build_drop` structure. Compiler v12 now
  grounds both required exclusions directly in the real user directions,
  without hardening ordinary calm preferences or unrelated percussion limits.
  Integration coverage proves an incomplete model translation remains blocked.
- The jazz Mood replay/simulation also admitted Parov Stelar “Josephine
  (Candlelight Version)” through the generic swing parent despite having only
  Electronic/electro-swing/chamber-pop evidence. Electro swing now maps to
  Electronic before generic swing; explicit jazz tags and ordinary swing remain
  eligible for jazz. [Austrian Music Export](https://www.musicexport.at/artist/parov-stelar/)
  identifies the artist's music as electronic fusion; this is a conservative
  eligibility correction, not a factual rewrite of the recording's metadata.
- Focused regressions: 46/46 pass, TypeScript passes after correcting the literal
  tuple type. The old v6 replay/simulation continues unchanged to expose further
  defects; it is failed evidence and cannot authorize deployment. The f1a58e2
  image passed CI and its infrastructure pin was pushed as server `119ec99`, but
  MUST be replaced with the corrected, fully evaluated build before rollout.
- v28 full validation passes: 302/302 tests, TypeScript, production and all four
  worker builds. The current v6 matrix remains on its original bundled code so
  its findings are reproducible; a complete corrected-code replay and simulation
  remain required. No new-pipeline production migration or activation has begun.
- The descending Journey simulation exposed a separate reference gap: “The
  Lonely Trumpet” has an explicit plain `swing` style as well as electro swing.
  Plain Swing and Bebop are Jazz styles in the [Hancock Institute curriculum](https://jazzinamerica.org/Overview/Syllabus).
  The independent oracle now recognises exact Swing/Bebop/Hard-Bop/Post-Bop
  styles, while still rejecting electro swing alone, New Jack Swing and a swung
  groove. This does not undo the actual Josephine eligibility fix. Original v6
  results remain untouched; the corrected oracle also needs the full replay.
- All three v6 “forgotten jazz favourites” repeats returned zero despite an
  independent 31-recording observed-history pool: the model incorrectly set the
  native-star-only flag. Compiler v13 now grounds that flag in real exclusive or
  explicit-star requests; ordinary forgotten favourites use previously played
  OR favourited music. Saved hard choices remain protected, and explicit later
  broadening is respected. Prompting now distinguishes the two meanings. Added
  unit/integration coverage for unstarred enjoyed tracks and genuine star-only
  shortages; the original v6 replay is still running unchanged.
- v31 validation passes: 306/306 tests, complete production/worker build and a
  standalone TypeScript check run after generated build files settled. The first
  real chat correction/nightly trio in v6 passes ordering, retention and saved
  intent checks; its initial and correction simulations also pass fourteen nights.
  The later full corrected-code gate and production rollout remain outstanding.
- Final job review found that a manual refresh after a configuration edit could
  join an obsolete queued/running job. Requests now deduplicate within the current
  revision, supersede outdated queued/retry/auth/failed work, and leave any
  running publication leased until verification/rollback. Two regression cases
  cover queued/running overlap, repeated requests with tied timestamps and lease
  preservation. This does not change model selection; full validation is next.
- v32 full validation passes: 308/308 tests, standalone TypeScript after the
  complete production/worker build. No additional schema migration. The v6 model
  matrix is now on its final multilingual chat flow; all named-song correction
  and nightly repeats passed, including all three fourteen-night simulations.
- The complete original v6 gate is preserved locally as
  `evaluation/full-replay-v6-complete-before-climax-swing-favourite-fixes.json`:
  96 runs, 84/93 valid where independently sufficient (90.32%), three direction/
  exclusion violations, six false favourite-only shortages, zero errors and zero
  publications. All twelve correction and twelve nightly-chat stages passed.
  The original complete simulation is also preserved: 32 cases/448 nights,
  21 flags from the documented Jazz eligibility/reference issues.
- The corrected compiler passes the unchanged fixed rubric again: 38/40 (95%),
  baseline 21/40 (52.5%). A controller-only replay of the exact failed compiled
  outputs fills all twelve songs for the focus, jazz and forgotten-jazz examples.
  Electronic direction still has a targeted reference/eligibility flag under
  investigation; this replay is feasibility evidence, not the final live gate.
- Album recency review found artist/name grouping misses cross-artist
  compilation plays. A native read-only sample exposes AlbumId and AlbumArtist
  on all 500 songs. Listening identity version 3 now preserves them and refreshes
  older caches; owner-specific recency follows native album identity, falling
  back to album artist/name only when unavailable. Undated plays remain uncertain.
  Added owner/compilation, distinct-album and undated-play coverage. This uses the
  existing snapshot version column: database schema remains 27.
- Auditing the entire eligible Electronic pool separated two real parsing errors
  from two reference gaps. Generic `garage`/`industrial` roots admitted garage
  rock and industrial rock (Tommy James/Puscifer); explicit rock compound terms
  now keep their Rock parent before Electronic fallback. The independent
  reference now recognises recorded trance/electropop (Kate Ryan/Madonna), while
  still rejecting those Rock cases. No fixed 40-case gold labels changed.
  Compiler v14 invalidates earlier interpretations after this alias correction.
- Native album/history integration and owner-isolation coverage passes; v34 full
  regression/build validation passed 316 tests and TypeScript. The final alias
  regression is also passing. Full final validation/replay remains pending;
  production is still the original image, schema 12 and new-pipeline flag off.
- v35 full validation passes: 317/317 tests, production/four-worker build and
  standalone TypeScript. The final full model replay will use listening identity
  v3 and compiler v14. The actual 23 October 04:30 Zurich cycle began while
  production was still unchanged; do not count its legacy publications toward
  the required new-pipeline observations.
- The final-v10 content replay uses an exact private v3 listening snapshot
  (SHA-256 `c8ca173f5eab20bb78495b6bfce8e399f1b4cc5775daacb39cf44cb70ac0932d`).
  All 16,359 songs have native album ID/album artist; 58 albums have multiple
  track artists. The read-only audit finds three previously eligible recordings
  whose albums actually had newer plays (including “Nightrider”). The original
  v6 input was recovered only after reproducing its exact original SHA-256;
  both frozen inputs are private and preserved locally with mode 0600.
- Publication-path review found two retry gaps while content evaluation ran:
  accepted chat corrections now always fence earlier proposals, including when
  an old refresh is waiting to retry without a lease. Duplicate submissions do
  not advance the revision twice. Invalidated/shortage proposals can regenerate
  on retry only before a native attempt: any uncertain journal or matching native
  checkpoint keeps its original IDs. The prior proposal remains available for
  failure/shortage status. Preview-save authentication errors retain auth-wait
  classification rather than becoming metadata errors. Focused tests pass.
- Rebundling all three content evaluators after those publication-only changes
  produces byte-identical SHA-256 hashes to the running final-v10 bundles. The
  content/model gate therefore continues unchanged; full publication regression
  validation is next. No production deployment or new-pipeline night yet.
- Publication validation v36 passes 321/321 tests, TypeScript and the production/
  worker build. Tests cover retry-time chat correction fencing, idempotent
  submissions, regeneration before any native write, preservation of uncertain
  and verified checkpoints, and preview-save auth failures. The content replay
  and its frozen inputs remain unchanged and are passing so far.

- The v10 hard chat correction exposed another actual false shortage in all
  three repetitions: “instrumental piano jazz” became `style=piano_solo`,
  admitting only two recordings despite 100 independently eligible examples.
  The model also invented retention anchors without a real keep request.
  Compiler v15 maps that unsupported solo restriction to mandatory piano
  instrumentation while preserving configured/saved rules and explicit solo
  directions; new anchors need retention language in real user directions.
  Ensemble/absent-piano/vocal/electronic integration coverage and explicit
  solo/saved-rule regressions pass. Full validation: 325/325 tests and the
  production/four-worker build; standalone TypeScript and a fresh complete
  content replay follow. The unchanged v10 replay continues as failed evidence.
  The verified f7820dc image and server ffc9858 pin are therefore superseded
  candidates, not authorized deployment results. Production remains unchanged.

- One v10 exact-artist correction failed safely after its one repair: the
  additions model repeated Basket Case (7115), which the controller had already
  retained and locked first. Its full publication intent exposed that retained
  ID despite excluding it from the additions batch. The selection prompt and
  repair now receive only summary/arc/hard/soft musical intent; resolved pins,
  positions, named requests and excluded IDs remain application-owned. A
  regression covers both initial and repair contexts while retaining final
  identity/constraint enforcement. Full suite: 326/326; production/four-worker
  build passes. TypeScript and the corrected complete v11 gate are next.

- The original v10 German simulation exposed a relative-reference defect:
  its original second song (James Taylor) was vocal and correctly replaced.
  Both the oracle and a fresh nightly model interpretation then treated its
  instrumental replacement as a newly requested second lock. The original
  request only protected Emancipator at position zero. Compiler v16 reuses
  saved intent without inference when the configuration revision is unchanged;
  even a configuration recompile cannot create new historical relative anchors.
  The independent live/simulation oracle now keeps references to the original
  pre-correction selection for all later nights. A moved original lock still
  fails, while replacing an unrequested second song is allowed. This changes
  no musical-fit gold labels and preserves the untouched failed v10 artifacts.
  Added direct and integration regressions; 328/328 tests and the complete
  application/worker build pass. Final TypeScript and the full v11 replay follow.

- Final v11 gates pass for application build
  `9342834ce15cf206dd61c30738b1d41ef8041278` (compiler v16): 96 live stages,
  93/93 valid where independently sufficient, three correctly reported
  undersupplied starred-only cases, zero errors/independent violations and
  all 12 correction/12 nightly stages. Exact listener hash remains `c8ca173…932d`.
  Median pipeline latency 50.825 s, p95 95.295 s, maximum 150.055 s.
- Complete v11 simulation: 32 cases/448 nights, zero violations. Of 16 held
  nights, 14 are the deliberate starred-only shortage; two Rediscovery nights
  exhaust all replacements under the removal cooldown and preserve the prior
  twelve-song mix. No shorter selection is published.
- Final fixed rubric: 37/40 (92.5%) versus frozen deployed baseline 21/40
  (52.5%), +40 percentage points. Three misses are empty false shortages:
  extra acoustic-drum, electric-guitar or steady-tempo requirements. They are
  retained as limitations; no gold labels or unknown evidence were weakened.
  Full artifacts are private under `evaluation/*-v11.json` and
  `evaluation/final-evaluation-gates-v39.json`; all gates assert `allPassed=true`.
- Final 328-test suite, standalone TypeScript, complete production/four-worker
  build, exact-commit CI/container publication and all four acquisition audits
  pass. The verified image index is `97d416dd4f4c1f171530e92c151d7a51b49416bab553d594cc7b4f0bac32c044`,
  amd64 `8868a8fe6c0a5f6937e74d5a5c2937a2c13f9d4ee32fa46ebbd080924e0b6a58`.
  A fresh encrypted production backup at 05:21 UTC passed authenticated
  decryption/SQLite quick_check (schema 12, 16 definitions, 16,344 files).
  Before/after choice and encrypted-credential hashes are recorded for rollout.
  Final Helm comparison changes only the Curator application and backup images.
  Deployment, actual shadow night, canary and three live nights remain pending.

- Production deployment completed 23 October at 05:48 UTC: Helm revision 91,
  application build `9342834`, server pin `d9b6fee`. The new pod is Ready with
  zero restarts; all four supervised workers and their fresh heartbeats are
  verified. Health/readiness return 200, and the chart integration test passes
  for the music stack. Live schema is 27; hashes prove all sixteen definitions,
  thirteen enabled/three disabled choices and encrypted credentials unchanged.
- A live HTTP audit of all four accounts passes: only busykoala sees its sixteen
  definitions; other accounts see none, foreign detail/chat access is 404,
  cross-user selection is 403 and unauthenticated access is 401. The four
  temporary scoped test sessions were deleted. History/recommendations remain
  owner-scoped. Evidence: `rollout/owner-audit-v39.json`.
- Applied the identity-bound Green Day source review in production: the known
  a cappella example no longer satisfies a guitar requirement, with zero raw
  tag/profile writes. Imported all 16,344 hash/model-matched vectors, zero
  skips. The private evaluation database was preserved separately, never
  promoted. All reports/tools and frozen inputs survive pod replacement in
  the owner-only persistent archive (`artifact-preservation-v39.json`).
- Activated guarded `shadow` mode after those checks. Its 23 October daytime
  catch-up is an unpublished rehearsal, not a qualifying nightly comparison.
  Initial thirty-song examples complete without violations/publication. The
  actual scheduled shadow cycle is 24 October, 04:30 Europe/Zurich. Canary,
  wider enablement and three qualifying production nights remain outstanding.

- Daytime production rehearsal completes for all 13 enabled playlists on the
  first attempt, with requested sizes (18/24/30), no shortages/violations and
  zero shadow publications. Discovery generates 24 playable tracks while its
  legacy acquisition is independently deferred; its nine additions comprise
  six familiar-style and three adjacent-style recordings. Rediscovery replaces
  unsuitable legacy tracks with observed-history selections; future rotation
  continues under the preserved control. Real examples and job receipts are
  in `rollout/shadow-examples-v39.json` and `shadow-rehearsal-v39.json`.
- The canary operator now schedules due work before its idempotent request so
  it coalesces with a due nightly job, avoiding a manual/nightly pair. This is
  operator-only ordering; deployed application/content bundles are unchanged.
  The actual 24 October shadow night, Discovery pool/research/acquisition
  runtime checks, wider enablement and three healthy nights remain outstanding.

- User-directed immediate rollout: the Discovery canary published 24 tracks at
  15:20 UTC on its first attempt. Its nine replacements comprise six familiar
  and three adjacent recordings. Native song ordering matches, and exactly one
  live native identity is associated with the definition. The old acquisition
  remains deferred independently. Switched `canary`→`enabled`, then requested
  one durable production refresh for each remaining enabled playlist.
- At 15:32 UTC all thirteen enabled playlists passed exact native ordering,
  requested counts, owner/revision, pins/positions, selection constraints and
  duplicate-publication checks. Every job succeeded on its first attempt.
  Repeating the stable batch request reused all existing job identities. The
  three disabled chat definitions remain disabled; their saved-intent behaviour
  is covered by the passing live correction/nightly replay stages.
  Evidence: `rollout/triggered-canary-v39.json` and
  `rollout/triggered-all-playlists-v39.json`. These are real triggered production
  publications, not observed overnight cycles. Health/readiness are 200 and
  all four workers have fresh heartbeats. A second live four-account HTTP
  isolation audit passes after enablement; all temporary sessions were removed.

## Immediate rollout closeout

- The user's requested triggered run is complete. A final recheck at 20:04 UTC
  still passes all thirteen publications: 372 songs, 133 changed, requested
  counts and exact native order, zero selection violations, no duplicate live
  publication identities and no uncertain publication journal entries.
  The mode remains `enabled`, health/readiness are 200, and all four workers
  have fresh heartbeats. The deployed application remains verified build
  `9342834`; operator/docs commit `5a6684a` also passed CI and container build.
- The live UI/API audit confirms thirteen ready playlists, three disabled
  definitions without a next run, and the next enabled refresh at 04:30 Zurich
  on 24 October. All four accounts pass ownership isolation; temporary sessions
  were removed. Private reports: `rollout/owner-ui-audit-enabled-v39.json`,
  `rollout/triggered-all-playlists-v39-final.json`, and `final-assessment.json`.
- Production research replenished 2→3→4 verified recommendations, including
  a normal worker refill (Floating Points — Crush). One verified French 79
  album was admitted and processed by acquisition; the one-per-playlist/day
  cap held through repeated checks. The old Answer Code Request acquisition
  remains independently deferred with its existing data preserved.
- **Known external degradation:** MusicBrainz continues returning HTTP 503.
  The current verified pool is **4/10**, not ten; it contains Weval — The Weight,
  Weval — Remember, Floating Points — Crush and French 79 — Teenagers. Shared
  and provider cooldowns remain intact, with automatic background research.
  Healthy-source ten-candidate and cached refill proofs passed in the isolated
  real-data evaluation; those recommendations were never copied to production.
  This closeout does not claim a full production research pool or a recovered
  MusicBrainz service. Publication remains independent of both research and
  acquisition availability.
- Per the user's explicit trigger-and-finish amendment, no observed overnight
  cycle or three-night pass is claimed. The original timed observer remains
  available. The final rubric retains its three documented false shortages;
  evidence and hard constraints were not weakened to hide them. Persistent
  backups, prior selections, private reports and operator tools remain available
  for rollback and later scheduled observations.

## Discovery retry follow-up

- The remaining production pool shortfall exposed an application issue alongside
  the external outage: a partial/failed research cycle always waited another
  two hours plus jitter, even when provider cooldowns were much shorter. Growing
  underfilled pools and source-deferred cycles now retry in 15–17 minutes; every
  provider still enforces its original cooldown and all existing caps. Truly
  empty successful searches retain the ordinary cadence. Exhausting the global
  daily request budget instead defers to the next UTC budget day. Persisted
  outcomes distinguish source deferral, budget deferral and no new matches,
  retaining the underlying provider errors and retry dates.
- Four new regression tests pass, including partial results, unchanged provider
  cooldowns, expired/stale errors, successful empty sources and daily rollover.
  Full suite: 332/332; production and four-worker build pass. Standalone
  TypeScript and exact-commit CI/container checks precede deployment.
  The musical selector, intent compiler, retrieval and chat code are unchanged;
  their previously completed live replay/rubric/simulation evidence is retained.
- A bounded two-request ListenBrainz metadata probe succeeded using the real
  discovery request budget. Its release-group metadata omits secondary types:
  a compilation and a remix collection both appear simply as “Album”. This
  cannot safely replace canonical compilation/edition checks during outages.
  No recommendation was admitted from this probe, no credentials were required,
  and no identity or musical-fit requirement was weakened.
- Build `9435d1c` deployed successfully as Helm revision 92; exact-commit CI and
  container publication pass. Authenticated fresh schema-27 backup verifies
  before deployment, and the manifest comparison permits only the Curator and
  backup images. All thirteen native playlists, four workers and chart tests
  pass afterward. A real research request reports `source_deferred`, retains
  the MusicBrainz 503/Retry-After and becomes due again in 15.35 minutes.
- Added a final edge regression: an outage early in a longer research cycle
  must remain visible even if its short cooldown expires before the cycle ends.
  The controller also records the current cycle's bounded failed-request
  receipts, rather than considering only still-active cooldowns. No identity,
  relevance, acquisition, inference or publication policy changes. This final
  safeguard requires a new exact-build deployment; revision 92 remains healthy.
- Final build `475be54` passes 333/333 tests, standalone TypeScript, production
  and four-worker build, and exact-commit CI/container publication. It is now
  deployed as Helm revision **93**, image index
  `97a86fc671be01478a74b4ffc088e4f0466dfec00ba5a8f3daa0311ac98ff896`;
  server pin `e641d17` is pushed. Both scoped manifest comparisons change only
  Curator's application and backup images. Unrelated server inventory and
  inference edits were preserved and excluded from the commits.
- Revision 93 is Ready with zero restarts. All four workers, health/readiness
  and chart integration tests pass. All thirteen prior native publications
  remain correct, with zero count/constraint/ordering violations or duplicate
  publication identities. No redundant playlist rotation was requested.
- The final real research cycle admitted one additional verified recommendation
  to the research pool, growing **4→5**, with no publication or acquisition.
  Another bounded diagnostic cycle preserved the actual failed request receipt
  and scheduled research for 20:46:28 UTC. This is a due time; the maintenance
  worker checks every fifteen minutes. Source usage is **67/100** requests,
  **5/20** editorial fetches, **0/5** general searches; album admission remains
  one, within all caps. MusicBrainz's captured 503 body says its web server is
  currently busy; an isolated canonical request also returned 200, confirming
  intermittent availability rather than a consistently empty catalogue.
- Evidence is private under `rollout/*-v41.*`,
  `discovery/research-response-observation.json` and the updated
  `final-assessment.json`. `selection-source-scope-v41.json` proves that all
  other application source, including musical selection/intent/retrieval/chat,
  is identical to the evaluated build. The remaining full-pool gate stays open;
  neither an inferred identity nor a compilation of uncertain type was used to
  fill it. No three-night observation is claimed under the user's amendment.

## Cache fallback correction

- The lighter single-edition lookup also hit an upstream connection timeout.
  A read-only audit identified fifty fresh public canonical responses retained
  from the live source tests. A guarded cache-only projection copied 53,682
  bytes with exact request-key/schema checks, original dates/TTLs and newer-
  production precedence. No owner recommendation, history, configuration,
  credential, raw tag or profile transferred; non-cache invariants are unchanged.
  This did not itself create any recommendations or lift a cooldown/budget.
- Three integration regressions then reproduced a real general fallback bug:
  artist/tag radio stopped at the first deferred identity, hiding later fully
  cached candidates even though cache hits require no provider requests.
  Both bounded loops now continue checking the remaining candidates. An
  unavailable first artist seed likewise cannot hide later cached seeds.
  Canonical artist mismatches remain rejected. Deferred cache misses fail before
  waiting for a network slot; final reservations still enforce caps atomically.
- Successful responses with an exhausted provider quota now remain visible as
  cooldown deferrals even when no error message exists. Seven new regressions
  cover these cases. Full suite: **340/340**. The production build and final
  deployed cache-fallback proof follow; the full ten-candidate gate remains open.
  Private evidence: `discovery/canonical-cache-audit.json` and
  `discovery/canonical-cache-transfer.json`. No evaluation database or synthetic
  playlist was promoted.
- Added an enforced cache-only research stage before online adapters. It can
  examine the remaining relevant cached seeds and cached tag batch sizes; its
  scope rejects every cache miss before any network slot, request reservation
  or optional page fetch. Wider bounded scans therefore consume zero provider
  requests. Known/dismissed/presented/deferred recommendations remain preserved,
  actual provider origins and adjacent-style labels stay intact, and canonical
  identity, official-album, musical-fit and recent-focus checks are unchanged.
- Four more regressions prove the cache-only scope restores normal behaviour
  afterward, reaches later cached seeds/recordings, reads another cached tag
  batch, and preserves already-associated owner recommendations. Full suite:
  **344/344**; production/four-worker build and standalone TypeScript pass.
  Two missing public radio response-cache rows (2,458 bytes) were reused after
  exact URL-key/schema/age checks; newer production responses won. This copied
  no owner recommendation rows or listening data and made no provider requests.
- The guarded real research proof then created **four** new owner-bound,
  fully validated recommendations through the normal controller, growing the
  production pool **5→9**. No MusicBrainz requests were needed for these four;
  normal online follow-up used one ListenBrainz request. Evidence:
  `discovery/cache-sweep-proof-v43.json` and
  `discovery/public-radio-cache-transfer.json`. The full ten-candidate gate
  remains open. The final cache-only build still requires exact-commit CI and
  deployment; the earlier cache-fallback image is a superseded candidate.
