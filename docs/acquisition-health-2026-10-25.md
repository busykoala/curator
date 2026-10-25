# Acquisition follow-up — 25 October 2026

The music-library acquisition target is separate from playlist renewal. Private
measurements and native service responses are in the ignored directory
`delivery/acquisition-recovery/2026-10-25-check/`.

At 20:34 UTC all music pods were ready with no recent restarts, storage warnings
or disk-space shortage. qBittorrent was connected with DHT/PEX enabled, no global
download limit, and about 15 TiB free. Nevertheless, it had no incomplete music
transfers. Three albums had completed in the preceding 24 hours, compared with
the earlier observed 36/day; that earlier throughput was not sustained.

The native monitored backlog was 3,921 releases: 2,697 albums, 748 singles, 452
EPs and 24 other releases. The album count includes 679 compilations and 1,815
albums without secondary types. Pending counts alone do not establish source
availability or imply that an album has no playable tracks.

## Confirmed corrections

- Provider batches stopped after two responses; the one additional batch could
  still leave later productive providers unqueried. Bounded batches now consider
  up to eight responding providers, attempting each at most once per album.
  Existing provider cooldowns, configured limits and download-capacity checks
  remain enforced. Empty bookkeeping batches do not count as completed searches.
- A completed download tracked by Lidarr as another album could indefinitely
  retain an accepted submission. Reconciliation now checks the requested album
  identity, retains in-flight or ambiguous transfers, and records completed
  mismatches against that particular target. The valid payload is retained and
  is not globally blocklisted. Subsequent searches avoid repeating that same
  mismatched source for the target.
- Complete-release import verification now recognises mastering-only
  “remastered version” labels and film-score credits bound to the canonical
  album title. Full track counts, unique positions, recording variants, close
  durations and exact native mapping agreement remain mandatory. The captured
  40-track James Newton Howard score passes the new independent proof; unrelated
  film credits and live/alternate recordings remain rejected.
- The failing, nonproductive MixtapeTorrent connector was disabled in both
  Prowlarr and Lidarr. Its configured one-query/day limit was blocking combined
  native reservations. Its limits were preserved, and other providers were left
  enabled. Other exhausted provider budgets remain real and are respected.

## Verification and limits

All 349 unit/integration tests, TypeScript and acquisition audits pass. A fresh
production backup was encrypted before operational changes. Deployment and
production checks are recorded below when complete.

Completed downloads with incomplete editions or uncertain recording identities
must remain blocked. Existing library files are not replaced just to clear a
queue warning. The initial edition-only Quincy Jones probe failed its post-change
check and restored the prior selection; it is not counted as a repaired import.
A higher sustained download rate must be measured after deployment; passing
health checks or increasing query volume does not prove the library target will
finish quickly.

## Production repairs and follow-up

- Acquisition commit `cc7b3d2` passed exact-commit CI/container publishing and
  deployed successfully as Helm revision 95. The chart test, readiness and all
  four worker checks passed. Only the Curator and backup images changed; unrelated
  infrastructure work was preserved.
- Booker T. & the MG’s — *Hip Hug-Her*: eleven WavPack tracks decoded correctly
  but had invalid duration metadata. An isolated pod mounted originals read-only,
  staged FLAC copies, and verified identical decoded PCM for every track. Native
  import required zero rejections, all eleven unique catalogue tracks, matching
  measured positions/durations and the existing import guard. The imported
  library is 100% complete and all eleven library PCM hashes match the originals.
  Generated staging copies and the temporary pod were removed; torrent originals
  were retained. The disputed “Slim Jenkins’ Joint”/“Place” title was not accepted
  through an invented alias or a weakened independent-title proof.
- Quincy Jones — *Big Band Bossa Nova*: all ten recordings were already present,
  but absent edition UUID tags let native scanning select an eleven-track bonus
  edition. After proving the complete ten-recording identity set, missing edition
  and track UUIDs were filled using the existing copy-on-write repair routine.
  Existing nonempty identity values were checked for conflicts first. The first
  any-edition attempt reached 10/10 but reverted after restart. The final repair
  holds the shared album write lease and explicitly pins the complete standard
  edition (`anyReleaseOk=false`), with unchanged FLAC audio MD5s. A second
  controlled Lidarr restart preserved 10/10 tracks and the selected edition.
  This reconciled existing music and is not counted as a new download.
- The real accepted Lou Reed collection submission was reconciled against a
  completed download actually tracked as studio *Transformer* (album 486).
  The collection remains wanted; the legitimate studio payload was retained.
- Follow-up code broadens nickname-heavy/accented provider queries while keeping
  canonical identities unchanged. A metered “Damian Marley” query found a
  reported ten-seeder release missed by the full nickname query. Native identity
  checks remain enforced; discovering a candidate is not a successful download.
- Verified import identity jobs now backfill complete native MusicBrainz edition,
  release-group, release-track and recording UUIDs when missing. UUIDs must be
  valid and bound to the verified artist/album; existing populated values remain
  protected. This protects identity information on recovered full releases.
  The exact writer responsible for the earlier Quincy tag loss was not proven.
- Exact-title native lookups for *Welcome to Jamrock* and *Kaya* remain ambiguous:
  the catalogue contains a same-name album/single or multiple release groups.
  A controlled Lidarr restart did not fix these cases; no native database rows
  were altered or deleted to disguise the ambiguity. These cases remain blocked
  until a trustworthy native mapping or stronger recording evidence is available.

The initial official Ubuntu diagnostic-page fetch reset before any probe torrent
was added. That result alone does not establish a peer-connectivity failure.
Final runtime measurements and any independent transport proof belong in the
private final assessment. Sustained acquisition throughput remains a separate
operational limitation until actual new downloads and imports demonstrate it.

The final safeguards build is `e34c7f7` (349 tests; exact-commit CI/container
workflows passed). It deploys as Helm revision 96 with immutable OCI index
`sha256:61bf28b97b4ce8c178cb3b42573afbf5d11ad03de7fc9e94efd574f68e1914ba`.
Native worker execution has independently recovered the complete 40-track James
Newton Howard score using the new bound film-credit handling. Two capped official
Ubuntu probes transferred actual bytes from peers and cleaned up completely;
there is no demonstrated general peer-connectivity outage.

## Final production assessment

At 21:35 UTC (22:35 Zurich), the monitored backlog was **3,918 releases**,
including **2,694 albums**, 748 singles, 452 EPs and 24 other releases. Three
albums have been reconciled to complete library files: Booker T. (11 tracks),
James Newton Howard (40 tracks), and Quincy Jones (10 existing tracks). All
three remained complete after the final controlled Lidarr restart. These
recoveries do not establish a new-download throughput rate.

Native blocked queue entries fell from 14 to 11. The redundant studio
*Transformer* warning was retired only after confirming the existing 13-track
library and its quality cutoff. Its torrent and library files were retained.
The other eleven imports remain blocked where track/edition evidence does not
support safe acceptance.

All six music deployments are ready. Curator readiness and all four worker
processes pass. qBittorrent has peer connectivity, no global download limit,
24 download slots, and approximately 15 TiB of available music storage. Two
capped official Ubuntu probes transferred 877,519 and 247,708 bytes from peers
and removed their temporary torrents/files. The initial diagnostic web-page
fetch reset; a failed external web request is not a peer-connectivity verdict.

**The bulk library target remains underperforming.** The final measured music
transfer rate is zero, with no active incomplete music torrents. Provider
quotas, unreported/unsupported quality, genuine edition mismatches and native
identity ambiguities still reject candidates. The initial preceding-day
measurement was only three complete albums; the previously observed 36/day
is not demonstrated now. The normal acquisition worker remains enabled and
unpaused, with bounded retries and no quota reset. Reconciliation cleared the
obsolete accepted Quincy submission; no accepted/submitting records remain.
Its final observed stage was import repair, with a live heartbeat and no global
worker error; a complete post-deployment search cycle was not yet observed. No completion date is
credible from the current evidence. Playlist settings were not changed.

Private JSON measurements, native proofs, encrypted backup and deployment
checks are retained under the ignored acquisition-recovery evidence directory;
credentials and private download URLs are not committed to this report.
