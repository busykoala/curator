"use client";
import Link from 'next/link';
import {useState} from 'react';
import {readJson} from './http';
import type {PlaylistDefinition} from './playlist-view-model';
const when=(value:string)=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
export function PlaylistRefreshInfo({playlist,changed}:{playlist:PlaylistDefinition;changed?:()=>void|Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!playlist.id||!playlist.refreshPipelineEnabled)return null;
  const retry=['retrying','failed'].includes(playlist.refreshStatus??''),working=['queued','refreshing'].includes(playlist.refreshStatus??'');
  async function refresh(){
    setBusy(true);setError('');
    try{await readJson(await fetch(`/api/playlists/${playlist.id}/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),retry:true})}));await changed?.()}
    catch(reason){setError(reason instanceof Error?reason.message:'Refresh could not be queued')}
    finally{setBusy(false)}
  }
  return<div className="playlist-refresh-info">
    <p role={working?'status':undefined}>{playlist.changeSummary}</p>
    <p className="muted small">
      {playlist.lastSuccessfulRefresh?`Last saved ${when(playlist.lastSuccessfulRefresh)}`:'No saved refresh yet'}
      {playlist.nextRefresh?` · Next ${when(playlist.nextRefresh)}`:!playlist.enabled?' · Nightly refresh off':''}
    </p>
    {Boolean(playlist.pendingDiscoveries)&&<p className="muted small">Waiting for {playlist.pendingDiscoveries} researched {playlist.pendingDiscoveries===1?'album':'albums'}. Your available music can still refresh.</p>}
    {playlist.listeningHistoryStatus==='stale'&&<p className="muted small">Using saved listening history{playlist.listeningHistoryCapturedAt?` from ${when(playlist.listeningHistoryCapturedAt)}`:''}. Recent plays and favourites may be missing.</p>}
    {playlist.listeningHistoryStatus==='unavailable'&&<p className="muted small">Listening history is unavailable. Unheard music cannot be confirmed.</p>}
    {retry&&<button className="text-button" disabled={busy} onClick={()=>void refresh()}>{busy?'Queuing…':'Retry refresh now'}</button>}
    {playlist.refreshStatus==='auth_required'&&playlist.refreshAuthService!=='inference'&&<Link className="text-link" href="/login">Sign in again</Link>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
