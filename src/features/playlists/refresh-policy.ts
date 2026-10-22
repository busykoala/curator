import {createHash} from 'node:crypto';
import type {PlaylistDefinition} from './types';
import {nextZurichRunSql} from './schedule-time';

export const refreshRetryDelays=[5*60_000,30*60_000,2*3600_000,6*3600_000] as const;
export type PlaylistRefreshMode='off'|'shadow'|'canary'|'enabled';
export function zurichDate(now:Date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function latestScheduledDate(now:Date){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(now);
  const n=(k:string)=>Number(parts.find(x=>x.type===k)?.value??0);
  const date=new Date(Date.UTC(n('year'),n('month')-1,n('day')-(n('hour')*60+n('minute')<270?1:0)));
  return date.toISOString().slice(0,10);
}
export function scheduledDateInstant(date:string){
  return Date.parse(nextZurichRunSql(new Date(`${date}T00:00:00Z`)).replace(' ','T')+'Z');
}
export function playlistRevisionHash(p:PlaylistDefinition){
  return createHash('sha256').update(JSON.stringify({id:p.id,owner:p.ownerUserId,name:p.name,category:p.category,intent:p.intent,config:p.config,revision:p.revision??1})).digest('hex');
}
export function publicationHash(ids:string[]){return createHash('sha256').update(JSON.stringify(ids)).digest('hex')}
export function isAuthenticationFailure(error:string){return /must sign in|token.+revoked|unauthori[sz]ed|\b401\b/i.test(error)}
