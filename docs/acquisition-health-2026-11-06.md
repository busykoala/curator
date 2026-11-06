# Acquisition and dashboard follow-up — 6 November 2026

## Outcome

The network and acquisition changes described below are deployed and production
has resumed real downloads and imports. Between 17:20:15 and 20:01:54 UTC:

- Monitored missing releases fell from **3,907 to 3,900**. This count includes
  albums, EPs and singles.
- qBittorrent's cumulative downloaded bytes increased by **7,282,034,157 bytes**.
  This includes both completed and still-incomplete transfers.
- Lidarr history confirms **seven releases / 115 tracks imported** in that
  window: Britney Spears, Yellowcard, Alice Cooper, Eric Prydz, Buena Vista
  Social Club, Fall Out Boy and Damian Marley.
- The final snapshot had six incomplete transfers. The Ventures was 77.8%
  complete and downloading at about 944 kB/s; War was 56.9% complete but
  stalled at that instant. Several other candidates had no payload or were
  waiting for metadata/peers.
- Approximately 16.63 TB remained free and qBittorrent was connected.

The 18:42 intermediate snapshot recorded 3,906 missing releases and
389,559,031 new payload bytes, matching the Britney Spears import. The later
6,892,475,126-byte increase through 20:01 is therefore sustained progress, not
merely queued torrents. It is still a short observation and does not support an
ETA for the remaining 3,900 releases.

## Confirmed blockers and changes

### Host networking

The server inherited unreliable ISP DNS resolvers, causing CoreDNS timeouts and
simultaneous provider failures. NetworkManager now ignores automatic DNS on
`blizzard-wifi` and uses `1.1.1.1` and `9.9.9.9`; CoreDNS was restarted.

The 5 GHz Wi-Fi link had severe latency, loss and stalled transfers. The server
now remains on the tested 2.4 GHz `bg` band. LAN latency improved to roughly
5–11 ms and a real 4 MiB HTTPS transfer completed in 2.406 seconds. DNS and band
settings are persisted in the server network role. No MTU change was made.

### Acquisition providers and cache

A durable SQLite source cache keeps positive results for six hours and verified
empty results for 24 hours, bounded to 20,000 keys / 64 MiB. Native grab handles
are not persisted. A live repeated query reused the same eight candidates with
zero additional provider requests.

Prowlarr HTTP-200 empty responses now require provider-health verification, so a
failed provider cannot create a cached "no results" observation. Provider
cooldown timestamps and request budgets remain enforced. Alternate queries and
quoted artist nickname handling were improved without weakening native
identity, quality, blocklist, seeder, capacity or endpoint-quota checks.

At the final check Prowlarr reported no disabled indexers and only an
update-available health notice. Two local source budgets were temporarily
exhausted and have future retry times; they were not reset. No request budgets
or attempt counters were reset to manufacture progress.

### Lidarr identity matching

Lidarr 3.1.0 could not resolve several same-title album/single pairs even with
the correct year. An isolated, consistent copy of the native database was used
to test 3.1.6 with download clients disabled, read-only media and blocked
outbound access. The upgrade resolved four of ten tested ambiguities while six
genuine edition ambiguities remained blocked.

Production is verified on **Lidarr 3.1.6.5079**, image digest
`sha256:d5707cfe084da21a3864c7ef0edd9c0543b5e26c79c551f84dad5ef8683af8c7`.
Fall Out Boy, Yellowcard, Alice Cooper and Eric Prydz subsequently imported
with complete native track counts. Wrong-edition and box-set guards remain in
force.

## Dashboard repair results

The initial stored dashboard contained 50 open issues: 42 identity warnings,
six album covers, one artist image and one deferred processing warning.

- The first verified repair pass completed 24 albums and wrote 333 files using
  copy-on-write and album leases.
- A scoped retry fixed the six blocked album covers after switching to the
  authenticated `/api/v1/mediacover/album/<id>/cover.jpg` endpoint and validating
  content type. Two albums whose local native cache returned 404 used the exact
  Cover Art Archive URL already recorded on the verified native album, never a
  fuzzy image substitute. All 98 files were then read back: every file has the
  intended release-group ID and embedded artwork.
- Four excluded identity cases received individual catalogue/native review.
  Weezer is the AJR-featured single, not the earlier solo single. Jazz Samba is
  the eight-track Stan Getz/Charlie Byrd album, with incorrect Various Artists
  IDs replaced. Tribe is native track 15 alongside sixteen sibling files that
  already had the same album identity. Initials B.B. is the original twelve-track
  1968 album, not the later compilation; only its release-group ID was written.
  All 22 resulting files were read back successfully.
- Ten identity warnings whose album keys no longer had library files were
  retired by normal reconciliation. The Johnny Cash and Damian Marley deferred
  cases subsequently completed through the normal worker after the shared
  MusicBrainz 503 cooldown; the limiter was not bypassed.
- Newly imported Britney Spears and Yellowcard albums received verified native
  covers in another 29 files.
- Jane Birkin & Serge Gainsbourg now use an exact duo photograph from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gainsbourg-Birkin-Italie-1976.png),
  with its public-domain/source and retouched/upscaled caveats recorded. A solo
  artist photo was not substituted.

At 20:04:18 UTC the stored open-issue count was **zero**. Ordinary imports and
processing can create new issues later, so this is a verified point-in-time
result rather than a permanent guarantee.

The derived dashboard still reported 8,852 timestamp-pending tracks in 606
albums. All 16,885 library tracks had complete semantic profiles at the current
versions; none was sparse or failed. Normal categorization is reusing unchanged
fingerprints and acknowledging timestamps in batches. It was not forced into a
library-wide AI reclassification. Derived informational gaps also remained for
scene in 15 albums and style/mood in eight albums each.

## Application fixes and rollout

Curator commit **`61315009a710d144eaa7588e24dc45dadbab243d`** now:

1. Updates database tag snapshots with written MusicBrainz IDs, dates, custom
   properties and aliases, including removals, instead of retaining stale
   evidence until a rescan.
2. Requires valid, consistent release-group UUIDs across every file before
   reconciliation closes an album identity warning, unless a confirmed manual
   override exists. This is an internal consistency check, not external
   catalogue verification.

Validation completed with **362/362 tests**, the production Next.js build and
all four bundled workers. GitHub CI run **42282984397** and container run
**42282984426** succeeded. A live unchanged tag write returned `unchanged`, left
file size/mtime untouched, and updated both typed and extra-property database
identity evidence to match the physical file.

The deployed Curator image is
`ghcr.io/busykoala/curator@sha256:c9bbf378db7ecdf4ca702114761bca29786b39e77112a89606bb4d3d2c293469`.
Infrastructure commit **`d7a95fc`** pins it in both required locations without
staging unrelated inference or inventory work. Final Helm revision **101** uses
chart **1.0.66**. All six music deployments and the live inference deployments
were ready; Curator health/readiness and all worker heartbeats passed.
Acquisition remains **unpaused**. Curator's schema migration level remains 28.

## Remaining limitations

- The backlog remains 3,900 monitored missing releases. A short burst of
  imports does not establish a durable completion rate.
- Six transfers were incomplete at the final snapshot; stalled peers and
  metadata waits can still prevent completion.
- Lidarr's queue contained 14 import-rejection entries. Evidence includes wrong
  compilation/track-set matches, missing tracks, existing destination files and
  already-imported albums. These must not all be treated as active failed jobs
  or bypassed with forced identities.
- Genuine same-year/edition ambiguities remain intentionally blocked.
- Timestamp-derived categorization work continues through the ordinary worker.

Private receipts, native history, before/after snapshots and file-level proofs
are in `delivery/acquisition-recovery/2026-11-06-check/` and the production
private evidence directory. Raw provider responses, credentials and database
copies are not committed. No playlist definitions or enablement choices were
changed.
