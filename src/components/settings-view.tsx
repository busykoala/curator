"use client";
import { useEffect,useState } from "react";
import { Check,Database,KeyRound,LoaderCircle,LogOut,Save,ServerCog,Sparkles } from "lucide-react";

type Settings={scanIntervalHours:number;enrichmentBatchAlbums:number;categorizationBatchAlbums:number;libraryPageSize:number;stackRefreshSeconds:number;navidromeUsername:string;navidromePasswordConfigured:boolean;lunaModel:string;terraModel:string;musicRoot:string};
export function SettingsView(){
  const[data,setData]=useState<Settings|null>(null),[password,setPassword]=useState(""),[saving,setSaving]=useState(false),[notice,setNotice]=useState("");
  useEffect(()=>{fetch("/api/settings",{cache:"no-store"}).then(response=>response.json()).then(setData).catch(reason=>setNotice(String(reason)))},[]);
  function number(key:keyof Settings,value:string){setData(current=>current?{...current,[key]:Number(value)}:current)}
  async function save(){if(!data)return;setSaving(true);setNotice("");try{const response=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,navidromePassword:password})}),body=await response.json();if(!response.ok)throw new Error(body.error||"Could not save settings");setData({...data,...body.settings,navidromePasswordConfigured:Boolean(password)||data.navidromePasswordConfigured});setPassword("");setNotice("Settings saved. New batch sizes apply at the next task boundary.")}catch(reason){setNotice(String(reason))}finally{setSaving(false)}}
  if(!data)return <div className="settings-loading"><LoaderCircle className="spin"/><span>Loading configuration</span>{notice&&<p>{notice}</p>}</div>;
  return <div className="settings-workspace">
    <header className="settings-intro"><span className="kicker">Curator configuration</span><h2>Settings</h2><p>Adjust normal operating behavior here. Risk-sensitive identity and file-safety thresholds remain protected by Curator.</p></header>
    {notice&&<div className="settings-notice"><Check/>{notice}</div>}
    <section className="settings-section"><div className="settings-section-title"><ServerCog/><div><h3>Processing cadence</h3><p>Control how often Curator checks the library and how much work it takes per cycle.</p></div></div><div className="settings-grid">
      <label><span>Full scan interval</span><input type="number" min="1" max="168" value={data.scanIntervalHours} onChange={event=>number("scanIntervalHours",event.target.value)}/><small>Hours between full reconciliations</small></label>
      <label><span>Enrichment batch</span><input type="number" min="1" max="24" value={data.enrichmentBatchAlbums} onChange={event=>number("enrichmentBatchAlbums",event.target.value)}/><small>Albums written before yielding</small></label>
      <label><span>Semantic batch</span><input type="number" min="1" max="64" value={data.categorizationBatchAlbums} onChange={event=>number("categorizationBatchAlbums",event.target.value)}/><small>Albums classified per request cycle</small></label>
    </div></section>
    <section className="settings-section"><div className="settings-section-title"><Database/><div><h3>Library experience</h3><p>Tune browser density and operational refresh without changing metadata.</p></div></div><div className="settings-grid">
      <label><span>Items per library page</span><input type="number" min="12" max="120" value={data.libraryPageSize} onChange={event=>number("libraryPageSize",event.target.value)}/><small>More items use more screen space</small></label>
      <label><span>Service refresh</span><input type="number" min="5" max="120" value={data.stackRefreshSeconds} onChange={event=>number("stackRefreshSeconds",event.target.value)}/><small>Seconds between stack checks</small></label>
      <label className="read-only"><span>Music library</span><input value={data.musicRoot} readOnly/><small>Configured by the container mount</small></label>
    </div></section>
    <section className="settings-section"><div className="settings-section-title"><KeyRound/><div><h3>Navidrome connection</h3><p>Optional credentials unlock playlist browsing. They stay server-side and are never returned to the browser.</p></div></div><div className="settings-grid">
      <label><span>Navidrome username</span><input value={data.navidromeUsername} onChange={event=>setData({...data,navidromeUsername:event.target.value})}/></label>
      <label><span>Navidrome password</span><input type="password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={data.navidromePasswordConfigured?"Configured / enter to replace":"Enter password"}/></label>
    </div></section>
    <section className="settings-section"><div className="settings-section-title"><Sparkles/><div><h3>AI routing</h3><p>Model identities are environment-managed; a single configured model replaces tiered fallback routing.</p></div></div><div className="settings-grid">
      <label className="read-only"><span>Primary model</span><input value={data.lunaModel} readOnly/></label>
      {data.terraModel!==data.lunaModel&&<label className="read-only"><span>Fallback model</span><input value={data.terraModel} readOnly/></label>}
    </div></section>
    <footer className="settings-footer"><button className="danger-link" onClick={()=>fetch("/api/auth/logout",{method:"POST"}).then(()=>location.href="/login")}><LogOut/>Sign out</button><button className="primary-button" onClick={save} disabled={saving}>{saving?<LoaderCircle className="spin"/>:<Save/>}Save settings</button></footer>
  </div>
}
