"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Send, RefreshCw, X } from "lucide-react";
import { readJson } from "./http";
import { type PlaylistDefinition, type PreviewItem } from "./playlist-view-model";

type State = {
  definition: PlaylistDefinition;
  revision: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  result: { reply: string; items: PreviewItem[]; detail: { durationMs: number; pending: number } } | null;
  synced?: boolean;
  syncError?: string;
  job?: { id: string; message: string; targetTracks: number; status: "queued" | "running" | "completed" | "failed"; error: string; resultRevision: number | null; updatedAt: number } | null;
};
type Submission = { requestId: string; message: string; targetTracks: number; revision: number };
const activeJob = (state?: State) => state?.job?.status === "queued" || state?.job?.status === "running";
function cachedSubmission(key: string): Submission | null { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } }
function cacheSubmission(key: string, value: Submission | null) { try { if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key); } catch {} }
type Props = { initial?: PlaylistDefinition; ownerUserId: number; close: () => void; changed: () => void };

export function PlaylistChat({ initial, ownerUserId, close, changed }: Props) {
  const [state, setState] = useState<State>();
  const [definition, setDefinition] = useState(initial);
  const [message, setMessage] = useState("");
  const [targetTracks, setTargetTracks] = useState(Number(initial?.config.targetTracks ?? 20));
  const [busy, setBusy] = useState(initial?.id ? "load" : "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const stateRef = useRef<State | undefined>(undefined);
  const sending = useRef(false);
  const mounted = useRef(true);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  const working = activeJob(state);
  const apply = useCallback((next: State) => {
    if(!mounted.current)return;
    const previous = stateRef.current;
    if(previous && (next.revision < previous.revision || (next.revision === previous.revision && (next.job?.updatedAt ?? 0) < (previous.job?.updatedAt ?? 0))))return;
    stateRef.current = next; setState(next); setDefinition(next.definition);
    if(!previous || next.revision !== previous.revision || activeJob(next))setTargetTracks(next.job && activeJob(next) ? next.job.targetTracks : Number(next.definition.config.targetTracks));
    setError(next.job?.status === "failed" ? next.job.error : next.syncError ? `Your draft is saved, but Navidrome could not be updated: ${next.syncError}` : "");
    if(next.synced)setNotice("Updated in Navidrome.");
    if(previous && (next.revision !== previous.revision || (activeJob(previous) && !activeJob(next))))changedRef.current();
  }, []);
  useEffect(() => { mounted.current=true;return()=>{mounted.current=false;}; }, []);
  useEffect(() => {
    const id=definition?.id;
    if(!id)return;
    let active=true,inFlight=false;
    const key=`curator-chat-pending:${ownerUserId}:${id}`;
    const refresh=async()=>{
      if(!active||inFlight||sending.current||document.visibilityState!=="visible")return;
      inFlight=true;
      try{
        let next=await readJson<State>(await fetch(`/api/playlists/${id}/chat`,{cache:"no-store"}),"Conversation could not be loaded");
        if(!active)return;
        const pending=cachedSubmission(key);
        if(pending){
          if(next.job?.id===pending.requestId){cacheSubmission(key,null);setMessage("");}
          else if(next.revision===pending.revision&&!activeJob(next)){
            next=await readJson<State>(await fetch(`/api/playlists/${id}/chat`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(pending),keepalive:true}));
            cacheSubmission(key,null);if(active)setMessage("");
          }else if(next.revision!==pending.revision){cacheSubmission(key,null);setMessage(current=>current||pending.message);}
        }
        if(active)apply(next);
      }catch(error){if(active)setError(error instanceof Error?error.message:"Connection interrupted. We will reconnect when this page is active.");}
      finally{inFlight=false;if(active)setBusy(current=>current==="load"?"":current);}
    };
    void refresh();
    const timer=window.setInterval(()=>void refresh(),3000);
    window.addEventListener("focus",refresh);window.addEventListener("online",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);};
  }, [definition?.id, ownerUserId, apply]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [state?.messages, busy, working]);
  useEffect(() => {
    if(!busy&&!working)input.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if(event.key === "Tab"){
        const nodes=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
        if(!nodes?.length)return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, working, close]);

  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;return()=>previous?.focus()},[]);

  async function submitMessage(text: string, count: number) {
    if(!text.trim()||busy||working||sending.current)return;
    sending.current=true;setBusy("submit");setError("");setNotice("");
    try{
      let playlist=definition;
      if(!playlist?.id){
        const created=await readJson<{playlist:PlaylistDefinition}>(await fetch("/api/playlists",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Chat playlist "+crypto.randomUUID().slice(0,8),category:"chat",enabled:false,intent:"",config:{targetTracks:count}}),keepalive:true}));
        playlist=created.playlist;if(mounted.current)setDefinition(playlist);changedRef.current();
      }
      const key=`curator-chat-pending:${ownerUserId}:${playlist.id}`;
      const pending=cachedSubmission(key)??{requestId:crypto.randomUUID(),message:text.trim(),targetTracks:count,revision:stateRef.current?.revision??0};
      cacheSubmission(key,pending);
      const result=await readJson<State>(await fetch(`/api/playlists/${playlist.id}/chat`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(pending),keepalive:true}),"Your message could not be submitted");
      cacheSubmission(key,null);if(mounted.current){apply(result);setMessage("");}changedRef.current();
    }catch(error){if(mounted.current)setError(error instanceof Error?error.message:String(error));}
    finally{sending.current=false;if(mounted.current)setBusy("");}
  }
  async function send(event:FormEvent){event.preventDefault();await submitMessage(message,targetTracks);}

  async function sync() {
    if (!definition?.id || busy || working) return;
    sending.current=true;setBusy("sync"); setError(""); setNotice("");
    try {
      await readJson(await fetch(`/api/playlists/${definition.id}/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: false }),
      }));
      const updated = await readJson<State>(await fetch(`/api/playlists/${definition.id}/chat`, { cache: "no-store" }));
      apply(updated); setNotice("Saved to Navidrome. Future chat corrections will update it there too."); changed();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { sending.current=false;if(mounted.current)setBusy(""); }
  }

  const items = state?.result?.items ?? [];
  return (
    <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} className="playlist-chat-drawer" role="dialog" aria-modal="true" aria-labelledby="playlist-chat-title">
        <header>
          <div><span className="kicker"><MessageCircle /> AI playlist</span><h2 id="playlist-chat-title">{state?.result ? definition?.name : "Describe what you want to hear"}</h2><p>Explore your music, then keep shaping the mix in conversation.</p></div>
          <button className="icon-button" type="button" aria-label="Close playlist chat" onClick={close}><X /></button>
        </header>
        <div className="playlist-chat-content">
          <div className="playlist-chat-conversation">
            <div className="playlist-chat-log" role="log" aria-live="polite" aria-label="Playlist conversation" ref={log}>
              {!state?.messages.length && <div className="playlist-chat-welcome"><MessageCircle /><p>Tell me about the sound, mood, artists, or occasion you have in mind.</p><small>Try “Late-night electronic music, dark and spacious” or “Warm instrumental jazz for reading.”</small></div>}
              {state?.messages.map((item, index) => <article className={`playlist-chat-message ${item.role}`} key={index}><strong>{item.role === "user" ? "You" : "Curator"}</strong><p>{item.content}</p></article>)}
              {state?.job && state.job.resultRevision === null && <article className="playlist-chat-message user"><strong>You</strong><p>{state.job.message}</p></article>}
              {working && <div className="playlist-chat-working" role="status"><LoaderCircle className="spin" /><span>{state?.job?.status === "queued" ? "Your message is queued." : "Exploring your library and shaping the mix…"} You can leave this page; the reply will be here when you return.</span></div>}
              {busy === "submit" && <div className="playlist-chat-working" role="status"><LoaderCircle className="spin" />Saving your message…</div>}
              {busy === "load" && <div className="playlist-chat-working" role="status"><LoaderCircle className="spin" />Loading your conversation…</div>}
            </div>
            {error && <p className="playlist-chat-error" role="alert">{error}</p>}
            {state?.job?.status === "failed" && <button className="secondary-button" disabled={Boolean(busy)} onClick={()=>void submitMessage(state.job!.message,state.job!.targetTracks)}>Retry message</button>}
            {notice && <p className="playlist-chat-notice" role="status">{notice}</p>}
            <form className="playlist-chat-composer" onSubmit={send}>
              <label htmlFor="playlist-chat-message">{items.length ? "What would you change?" : "Your musical direction"}</label>
              <textarea id="playlist-chat-message" ref={input} value={message} maxLength={3000} rows={3} disabled={Boolean(busy)||working} onChange={event => setMessage(event.target.value)} placeholder={items.length ? "Keep the opener, make it calmer, and add more piano…" : "Describe your playlist…"} required />
              <div><label htmlFor="playlist-chat-count">Songs <input id="playlist-chat-count" type="number" min={1} max={100} value={targetTracks} disabled={Boolean(busy)||working} onChange={event => setTargetTracks(Number(event.target.value))} required /></label><button className="primary-button" disabled={Boolean(busy) || working || !message.trim() || targetTracks < 1 || targetTracks > 100}><Send />{working ? "Working…" : busy === "submit" ? "Sending…" : items.length ? "Update playlist" : "Make playlist"}</button></div>
            </form>
          </div>
          <aside className="playlist-chat-songs" aria-label="Selected songs">
            <header><div><h3>Your mix</h3><small>{items.length ? `${items.length} songs · ${definition?.navidromePlaylistId ? "Linked to Navidrome" : "Draft"}` : "Songs will appear here"}</small></div>{state?.result && <small>{Math.round(state.result.detail.durationMs / 1000)}s</small>}</header>
            <div className="preview-track-list">{items.map((item,index) => <article key={item.fileId}><span>{index+1}</span><div><strong>{item.title}</strong><small>{item.artist} · {item.album}</small><em>{item.reason}</em></div></article>)}</div>
            {state?.result && state.result.detail.pending > 0 && <p className="playlist-chat-shortage">{state.result.detail.pending} more songs needed. Try broadening your request before publishing.</p>}
            <footer><button className="secondary-button" disabled={Boolean(busy) || working || !items.length || Boolean(state?.result?.detail.pending) || definition?.ownerTokenStatus !== "active"} onClick={() => void sync()}><RefreshCw />{busy === "sync" ? "Saving…" : definition?.navidromePlaylistId ? "Apply draft to Navidrome" : "Save to Navidrome"}</button></footer>
          </aside>
        </div>
      </section>
    </div>
  );
}
