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

All 347 unit/integration tests, TypeScript and acquisition audits pass. A fresh
production backup was encrypted before operational changes. Deployment and
production checks are recorded below when complete.

Completed downloads with incomplete editions or uncertain recording identities
must remain blocked. Existing library files are not replaced just to clear a
queue warning. The initial edition-only Quincy Jones probe failed its post-change
check and restored the prior selection; it is not counted as a repaired import.
A higher sustained download rate must be measured after deployment; passing
health checks or increasing query volume does not prove the library target will
finish quickly.
