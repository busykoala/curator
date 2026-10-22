# Goal: Make Curator’s nightly playlists reliable, personal, and worth returning to

## 1. Objective and confirmed starting point

**Implement and deploy a playlist pipeline that refreshes every enabled playlist reliably, preserves each listener’s intent, introduces worthwhile unfamiliar music, and explains its choices using real evidence. Validate it through automated scenarios, production examples, and three consecutive nightly cycles.**

The investigation found:

- **Discovery is blocked:** “Melodic Techno Radar” last refreshed on **12 September**. One queued album prevents the entire playlist from updating, while its two-candidate backlog prevents further research.
- **Scheduling is fragile:** refresh runs only within a 30-minute window, after enrichment work. The date is marked before completion, preventing reliable retries.
- **Selection underuses intent:** ordinary playlists ignore their free-text description; matching any one genre, mood, or context can qualify a song.
- **Personalisation is incomplete:** listening data is limited to 500 frequent songs and 500 favourites, and track identities are discarded.
- **Metadata coverage is already complete:** all **16,344 tracks** have semantic profiles. The next improvement should be better evidence and confidence, not indiscriminate reclassification.
- **Discovery ownership is unsafe:** candidates are associated through playlist names rather than stable playlist and owner IDs.
- **Chat nightly refresh currently republishes the existing selection.**

Agreed behaviour:

- Discovery primarily means **new to me**, across all release years.
- Approximately **70% familiar styles and 30% adjacent styles** within discovery additions.
- Nightly chat refresh changes part of the selection while preserving intent and corrections.
- Verified discoveries may download automatically, within caps.
- Free sources first; optional credentials must not be required.

## 2. Implementation sequence

Complete these work packages in order. Each must include its regression tests and pass before the next is enabled in production.

### A. Establish trustworthy measurements

Create a read-only playlist audit and a reproducible evaluation dataset.

Record per playlist: last successful publication, attempted refreshes, actual song changes, seven-day exposure, artist/album diversity, unresolved identities, constraint violations, discovery provenance, inference latency, and token usage.

Capture current selections and metadata as the baseline. Preserve a fixed evaluation subset so changes in the library do not distort comparisons. Distinguish “profile complete,” “playlist generated,” and “playlist successfully published.”

**Deliverable:** baseline report covering every current playlist and representative examples of all six types.

### B. Make nightly refresh durable and independent

Replace the window-based logic in [schedule.ts](/Users/speedy/Projects/curator/src/features/playlists/schedule.ts) with persistent, per-playlist jobs.

- Keep **04:30 Europe/Zurich** as the scheduled refresh time.
- A dedicated playlist worker polls due jobs every minute, independently of enrichment and acquisition.
- After downtime, run one catch-up refresh for each enabled playlist; do not replay every missed night.
- Use a unique playlist/date/job-kind key, leases with heartbeats, and persisted checkpoints.
- Retry transient failures after **5 minutes, 30 minutes, 2 hours, and 6 hours**. Authentication failures wait for renewed credentials.
- Keep failures visible until a successful retry. Calculate the next run from actual job state.
- Disabled playlists remain disabled and show no scheduled refresh.

Use one mutation lock across nightly refresh, chat corrections, preview publication, and manual refresh. Capture the playlist configuration revision before generation; discard results if the user changes the playlist meanwhile.

Persist the proposed song IDs before publication. Reuse the existing Navidrome verification and rollback behaviour, adding crash recovery so a restart between remote publication and local confirmation cannot create duplicate playlists or publish twice.

**Deliverable:** restart-safe refreshes that cannot be starved by a long enrichment batch.

### C. Repair Discovery’s lifecycle and ownership

Refactor [discovery.ts](/Users/speedy/Projects/curator/src/features/playlists/discovery.ts).

- Separate **research**, **acquisition**, and **playlist publication**. Waiting for downloads must never block a playable playlist refresh.
- Store shared release evidence separately from owner-specific playlist recommendations. Associate recommendations by `ownerUserId`, `playlistId`, and canonical release identity.
- Migrate legacy name-based associations only when there is exactly one matching playlist. Preserve ambiguous rows for review.
- Maintain a pool of **10 verified candidates per enabled discovery playlist**, replenished fairly across playlists.
- Run research throughout the day with jitter and persisted budgets; nightly publication consumes cached results.
- Default acquisition caps: **one new album per playlist per day, three globally per day, and six genuinely active discovery acquisitions globally**. Reuse an existing acquisition for the same release.
- After **48 hours without acquisition progress**, defer that recommendation for seven days and consider another candidate. Preserve its download and existing acquisition safety rules.
- A release becomes playlist-eligible only when matching tracks are playable and have verified native identities.
- Choose a representative track by musical fit and available track-level evidence. Replace the current “pin the first matching file” behaviour with a temporary discovery scoring boost.

**Deliverable:** “Melodic Techno Radar” refreshes from available music while its unresolved acquisition remains independently tracked.

### D. Build a dependable discovery-source layer

Use these sources for distinct purposes:

| Source | Purpose |
|---|---|
| [ListenBrainz artist/tag radio](https://listenbrainz.readthedocs.io/en/latest/users/api/core.html) | Similar artists and recordings, with MusicBrainz identities. An unauthenticated artist-radio request was verified during planning. |
| [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) | Canonical artists, recordings, release groups, dates, credits, and relationships. |
| [Bandcamp Daily](https://daily.bandcamp.com/) | Genre guides, overlooked catalogue releases, scenes, and editorial discoveries. |
| [Resident Advisor](https://ra.co/reviews) | Electronic music recommendations and descriptions. |
| [All About Jazz](https://www.allaboutjazz.com/reviews/) | Jazz recommendations and descriptions. |
| Official artist/label pages | Release and track-list verification. |
| [Last.fm similar artists](https://www.last.fm/api/show/artist.getSimilar) | Optional additional similarity evidence when an API key is configured. |

Implement provider adapters returning structured candidates and evidence. Prefer documented APIs, published feeds, and accessible editorial indexes. General web search becomes a bounded fallback, rather than a dependency on DuckDuckGo HTML parsing.

Required controls:

- Cache recommendations for seven days, fetched editorial pages for seven days, and stable identities for 30 days.
- Reuse the shared MusicBrainz limiter; respect its [one-request-per-second requirement](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting). Honour ListenBrainz rate-limit headers and provider `Retry-After` responses.
- Default daily discovery budget: **100 uncached provider requests globally**, including at most **20 editorial page fetches** and **five general searches**.
- A provider failure must not suppress other providers. Persist cooldowns and distinguish unavailable sources from empty results.
- Store source URL or API identity, retrieval date, supported claims, and recommendation origin. An opened URL alone does not prove an album claim.
- Require resolved release identity plus supporting recommendation evidence before automatic acquisition. Never infer a release date from an article’s publication date.
- Preserve Unicode identities and distinguish original releases from reissues.

Research candidates of any age. Give approximately **25% of researched candidates** a recent-release focus, without forcing that quota into the playable playlist.

**Deliverable:** candidate research continues when general search or any single editorial source is unavailable.

### E. Improve metadata and listener evidence

Introduce a versioned evidence view used by playlist selection.

- Canonicalise aliases consistently across UI options, search, scoring, and prompts. Fix field mismatches such as `instruments` versus `instrumentation`.
- Record field-level provenance: user override, embedded tag, identified external source, measured audio feature, or model inference. Include evidence scope and confidence category.
- Preserve user overrides. Conflicting factual evidence becomes unknown or reviewable, rather than silently overwritten.
- Separate original recording/release dates from edition dates. Prefer verified recording IDs for deduplication; preserve distinct live, studio, acoustic, and remix versions.
- Treat current audio features as limited measurements. BPM estimates require ambiguity handling; loudness alone must not establish musical intensity. Do not claim vocal or instrumental detection from measurements that cannot support it.
- Audit **120 stratified tracks**, including vocal/instrumental ambiguity, quiet rock, energetic jazz, live recordings, compilations, and non-Latin names.
- Re-enrich affected tracks incrementally, prioritising active playlist candidates and new imports. Default cap: **100 tracks daily**, yielding to interactive chat.

Collect owner-specific listening data with pagination and stable song IDs. Store play counts, last-played dates, favourites, available ratings, and playlist exposure separately. Retain the last valid snapshot when the listening service fails; label stale data. Never treat absence from a truncated response as proof that music is unheard.

**Deliverable:** selection can distinguish evidence from inference and use each listener’s complete observed history.

### F. Give each playlist type a distinct selection policy

Replace the loose matching in [candidate-score.ts](/Users/speedy/Projects/curator/src/features/playlists/candidate-score.ts) with a shared eligibility, ranking, and sequencing pipeline.

Compile configuration and free-text intent into a cached, validated intent specification. Explicit exclusions and factual requirements are hard constraints; moods and contexts influence ranking unless the user explicitly makes them mandatory.

| Type | Intended contents |
|---|---|
| Discovery | Unheard or underexposed recordings and unfamiliar artists, primarily within the listener’s taste, with adjacent exploration. |
| Deep Dive | Less-exposed tracks within the chosen style, broader artist/album coverage, and occasional familiar anchors. |
| Mood | Consistent mood and listening context; a genre match alone is insufficient. |
| Journey | A coherent selection following the requested energy arc, without sacrificing relevance to optimise BPM. |
| Rediscovery | Previously enjoyed or explicitly favourited music not heard recently. Unplayed music is not a forgotten favourite. |
| Chat | The saved conversation intent, including exclusions, retained songs, positions, and later corrections. |

Preserve existing rotation settings; default remains **30% per night**. Keep valid pins and position locks, then retain the required share of suitable songs. Fill replacement slots from ranked candidates.

Add a **14-day cooldown for recently removed recordings**, a seven-day exposure penalty across that owner’s playlists, artist spacing, and recording-aware deduplication. Relax exposure preferences only when necessary, recording the reason. Never relax explicit exclusions to fill the count.

If there are insufficient suitable, playable tracks, retain the previous playlist and expose the shortage. Initial creation may show a shorter preview, but must report it honestly.

**Deliverable:** observable differences between playlist types, with controlled rotation and no irrelevant padding.

### G. Improve local AI retrieval, prompting, and tools

Keep the current local `curator` route. Benchmark the deployed model and template; do not switch models simply because another is larger.

Use an application-controlled workflow:

1. Compile or update intent when configuration or conversation changes.
2. Retrieve eligible candidates.
3. Let the model compare and select from supplied candidates.
4. Validate constraints, identities, counts, pins, and ordering in code.
5. Allow one repair attempt; otherwise retain the last good result.

Add typed tools for `get_listener_context`, `search_library`, `inspect_tracks`, `get_discovery_candidates`, and `validate_selection`. Tool outputs include stable IDs, concise evidence, uncertainty, and pagination. Publication and acquisition remain application operations.

Use the existing local embedding service for semantic retrieval from canonical track descriptions. Store embeddings by content hash and model version; combine the top lexical and semantic results, capped at **120 candidates**. Rank with the existing local reranker and supply at most **60 candidates** to the generative model. Fall back to lexical ranking when retrieval services fail.

Prompts should contain explicit priority rules, a few difficult examples, compact evidence, and task-specific output schemas. Keep tool calling and final structured output as separate stages, consistent with the model’s [function-calling interface](https://qwen.readthedocs.io/en/latest/framework/function_call.html).

Defaults:

- At most six tool rounds and 12 calls per selection.
- Four-minute total deadline, including retries.
- One background generative request at a time; interactive chat takes priority.
- Honour inference `Retry-After`; stop repeating identical tool calls.
- Track failed-call usage and latency as well as successful calls.

Nightly chat refresh uses persisted intent and constraints without inserting a fabricated user message. Its result must be superseded by any newer user correction.

**Deliverable:** bounded, inspectable AI decisions with deterministic enforcement and graceful fallback.

## 3. Interfaces and user experience

Add these internal contracts:

- `PlaylistIntent`: hard constraints, soft preferences, pinned recordings, position locks, source revision.
- `PlaylistRefreshJob`: owner, playlist, scheduled date, revision, lease, stage, retry time, publication checkpoint.
- `DiscoveryRecommendation`: playlist association, canonical release identity, evidence, lifecycle state, acquisition link.
- `PlaylistEvaluation`: eligibility, novelty, diversity, rotation, uncertainty, timing, and publication results.

Extend existing playlist responses with `lastSuccessfulRefresh`, `nextRefresh`, `refreshStatus`, `shortage`, and a concise change summary. Provide owner-scoped refresh/retry and discovery-dismiss actions using existing authentication conventions.

Keep the UI simple: retain the nightly-refresh toggle and existing controls. Show “9 songs refreshed,” “Waiting for two researched albums,” or “Kept yesterday’s mix: insufficient matching tracks.” Add an expandable “Why these songs?” view with evidence links. Avoid exposing operational budgets as everyday playlist settings.

## 4. Tests and acceptance criteria

Build fixtures and replay tests before production rollout:

- Missed night, restart during generation/publication, repeated scheduler ticks, timezone/DST transitions, and enrichment failure.
- Two users with identical playlist names; renames and deletions; no cross-user history, feedback, recommendations, or publication.
- Permanently stalled discovery acquisition while nightly refresh and further research continue.
- Provider timeout, 429, malformed output, contradictory release dates, and a source page mentioning a different album.
- Hard exclusions, pinned tracks, position locks, insufficient candidates, duplicate recordings, and live/studio distinctions.
- Metadata unknowns, stale listening data, multilingual prompts, and the existing chat correction scenarios.
- AI attempts to select unseen IDs, weaken requirements, follow instructions embedded in source content, or exceed its budget.

Run **24 representative intent scenarios three times each** against the live local model using read-only inputs. Require zero published hard-constraint violations and at least 95% successful, valid selections where sufficient candidates exist.

Simulate 14 nightly refreshes. Where the eligible pool is sufficient, require requested size, configured rotation within one song, preserved pins, and no re-entry during the removal cooldown.

Use a fixed 40-case musical-fit rubric with positive and negative reference examples. Require at least **80% passing cases and a 15-percentage-point improvement over baseline**. Treat model-judge ratings as supporting evidence, not the sole quality gate.

## 5. Execution, rollout, and completion

The implementing agent should:

1. Save this goal and a numbered progress checklist in the repository’s documentation.
2. Produce baseline reports, implement packages A–G in order, and attach evidence to each completed package.
3. Run unit/integration tests, the production build, migration tests, and the playlist evaluation suite.
4. Deploy behind a feature flag and compare unpublished results for one nightly cycle.
5. Enable the new pipeline first for “Melodic Techno Radar,” then for the remaining enabled playlists after its checks pass.
6. Verify three consecutive production nights, checking shortly after 04:30 and using long sleeps between checks.
7. Iterate on failures without weakening identity, ownership, or explicit musical constraints.

**The goal is complete only when:**

- Every enabled playlist publishes by 06:00 on all three healthy nights; outage recovery completes within 30 minutes of dependencies becoming available.
- Discovery refreshes despite pending downloads and maintains a replenishing, evidenced candidate pool.
- No cross-user leakage, duplicate publication, unexplained count reduction, or hard-constraint violation occurs.
- Chat refresh preserves saved intent and corrections.
- Evaluation and operational budgets pass, and reports show actual improvements over the baseline.

Use additive migrations and retain previous playlist snapshots for rollback. Preserve existing enablement choices and acquisition safeguards. Paid services, new heavyweight audio models, and external uploads of listening history are outside this goal.
