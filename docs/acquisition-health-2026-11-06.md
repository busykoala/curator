# Acquisition follow-up — 6 November 2026

The 17:20 UTC baseline confirms that acquisition remains severely under target.
There are 3,907 monitored missing releases, only eleven fewer than the final
25 October inventory. All music services are running, storage has approximately
15 TiB free, and qBittorrent is connected with 376 DHT nodes, but there are no
incomplete music transfers. Curator completed 2,240 searches in the preceding
day, while several sources exhausted their rolling budgets. Eight album records
in that window currently report complete files; that includes reconciliation
of existing music and does not prove eight newly downloaded albums.

## Confirmed blockers and changes

Lidarr 3.1.0 cannot resolve many same-title album/single pairs even with the
correct year. Ten live read-only identity scenarios reproduced the failure,
including *American Beauty/American Psycho*, *Sweet Dreams*, *Singularity* and
*Ocean Avenue*. Fifty-one staged targets record this class of ambiguity.
The official [3.1.6 release](https://github.com/Lidarr/Lidarr/releases/tag/v3.1.6.5079)
adds year-aware matching. The candidate is tested against an isolated, consistent
copy of the native database before any production upgrade. Download clients
are disabled on the copy, its media mount is read-only, and outbound networking
is blocked. Genuine same-year/edition ambiguity must still fail Curator's exact
native-ID guard.

Provider results previously disappeared after ten minutes or a worker restart.
Repeated searches then spent limited provider capacity retrieving the same
results, including empty ones, while unrelated albums waited. An additive
schema migration introduces a durable acquisition cache: positive results live
six hours and empty results one day. Cache keys include provider and full query;
a new album has a separate key from an empty artist search. Only enabled
providers are considered. Errors are not cached as successes, and native cached
grab handles are never persisted. Reused releases retain their observation date
and still require the existing identity, quality, seeder, blocklist, capacity
and native approval checks. Stored payload is bounded to 64 MiB and 20,000 keys.
Provider quotas remain enforced on actual uncached requests.

## Validation and rollout

Runtime outcomes, migration evidence and final throughput measurements are
recorded after deployment. Private source responses, URLs and database copies
stay in the ignored acquisition-recovery evidence directory.
