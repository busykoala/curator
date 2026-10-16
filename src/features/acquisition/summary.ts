import { db, stateGet, stateSet } from '@/features/db/client';

export function acquisitionSummary() {
  let value: Record<string, unknown> = {};
  try { value = JSON.parse(stateGet('acquisition_summary', '{}')); } catch {}
  const latest = db().prepare('SELECT action,status,evidence_json evidence,created_at createdAt FROM download_interventions ORDER BY id DESC LIMIT 1').get() ?? null;
  const sources = JSON.parse(stateGet('source_scores', '[]')).map((source: { indexerId: number }) => {
    let failure: { retryAt?: string } = {}, status: { at?: string; results?: number } = {};
    try { failure = JSON.parse(stateGet(`acquisition_source_error:${source.indexerId}`, '{}') || '{}'); } catch {}
    try { status = JSON.parse(stateGet(`acquisition_source_status:${source.indexerId}`, '{}') || '{}'); } catch {}
    return { ...source, temporarilyUnavailable: Date.parse(failure.retryAt ?? '') > Date.now(), lastSearchAt: status.at, lastResults: status.results };
  });
  const throughput = db().prepare(`SELECT
    (SELECT count(*) FROM source_outcomes WHERE event='search' AND created_at>=datetime('now','-1 hour')) requestsLastHour,
    (SELECT count(*) FROM source_outcomes WHERE event='search_failure' AND created_at>=datetime('now','-1 hour')) failedRequestsLastHour,
    (SELECT count(*) FROM download_interventions WHERE action='search' AND status='deferred' AND created_at>=datetime('now','-1 hour')) deferredTargetsLastHour,
    (SELECT count(*) FROM acquisition_targets WHERE datetime(imported_at)>=datetime('now','-1 day')) importedLastDay`).get();
  return {
    ...value, throughput, search: JSON.parse(stateGet('acquisition_search_status', 'null')),
    paused: stateGet('acquisition_paused') === 'true', running: stateGet('acquisition_running') === 'true',
    phase: stateGet('acquisition_phase', 'idle'), error: stateGet('acquisition_last_error'),
    observationUntil: Number(stateGet('acquisition_observation_until', '0')), latest, sources,
  };
}

export function acquisitionTargets(limit=100){return db().prepare("SELECT * FROM acquisition_targets ORDER BY CASE origin WHEN 'user' THEN 0 WHEN 'playlist' THEN 1 ELSE 2 END,updated_at DESC LIMIT ?").all(limit)}
export function acquisitionAction(action:string,targetId?:number){if(action==="run")stateSet("acquisition_requested_action","run");else if(action==="pause")stateSet("acquisition_paused","true");else if(action==="resume"){stateSet("acquisition_paused","false");stateSet("acquisition_requested_action","run")}else if(action==="retry-target"&&targetId){db().prepare("UPDATE acquisition_targets SET status='pending',attempts_today=0,next_retry_at=NULL,detail_json=json_set(detail_json,'$.operatorRetry',1),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(targetId);stateSet("acquisition_requested_action","run")}else throw new Error("Unsupported acquisition action");return acquisitionSummary()}
