"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
};
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

  useEffect(() => {
    if (!initial?.id) return;
    let active = true;
    fetch(`/api/playlists/${initial.id}/chat`, { cache: "no-store" }).then(response => readJson<State>(response, "Conversation could not be loaded"))
      .then(result => { if (active) { setState(result); setDefinition(result.definition); } })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setBusy(""); });
    return () => { active = false; };
  }, [initial?.id]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [state?.messages, busy]);
  useEffect(() => {
    if(!busy)input.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
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
  }, [busy, close]);

  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;return()=>previous?.focus()},[]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy("chat"); setError(""); setNotice("");
    try {
      let playlist = definition;
      if (!playlist?.id) {
        const created = await readJson<{ playlist: PlaylistDefinition }>(await fetch("/api/playlists", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Chat playlist " + crypto.randomUUID().slice(0, 8), category: "chat", enabled: false, intent: "", ownerUserId, config: { targetTracks } }),
        }));
        playlist = created.playlist; setDefinition(playlist); changed();
      }
      const result = await readJson<State>(await fetch(`/api/playlists/${playlist.id}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, targetTracks, revision: state?.revision ?? 0 }),
      }), "The playlist could not be updated");
      setState(result); setDefinition(result.definition); setMessage("");
      if (result.syncError) setError(`Your draft is saved, but Navidrome could not be updated: ${result.syncError}`);
      else if (result.synced) setNotice("Updated in Navidrome.");
      changed(); input.current?.focus();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  async function sync() {
    if (!definition?.id || busy) return;
    setBusy("sync"); setError(""); setNotice("");
    try {
      await readJson(await fetch(`/api/playlists/${definition.id}/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: false }),
      }));
      const updated = await readJson<State>(await fetch(`/api/playlists/${definition.id}/chat`, { cache: "no-store" }));
      setState(updated); setDefinition(updated.definition); setNotice("Saved to Navidrome. Future chat corrections will update it there too."); changed();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  const items = state?.result?.items ?? [];
  return (
    <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section ref={dialog} className="playlist-chat-drawer" role="dialog" aria-modal="true" aria-labelledby="playlist-chat-title">
        <header>
          <div><span className="kicker"><MessageCircle /> AI playlist</span><h2 id="playlist-chat-title">{state?.result ? definition?.name : "Describe what you want to hear"}</h2><p>Explore your music, then keep shaping the mix in conversation.</p></div>
          <button className="icon-button" type="button" aria-label="Close playlist chat" disabled={Boolean(busy)} onClick={close}><X /></button>
        </header>
        <div className="playlist-chat-content">
          <div className="playlist-chat-conversation">
            <div className="playlist-chat-log" role="log" aria-live="polite" aria-label="Playlist conversation" ref={log}>
              {!state?.messages.length && <div className="playlist-chat-welcome"><MessageCircle /><p>Tell me about the sound, mood, artists, or occasion you have in mind.</p><small>Try “Late-night electronic music, dark and spacious” or “Warm instrumental jazz for reading.”</small></div>}
              {state?.messages.map((item, index) => <article className={`playlist-chat-message ${item.role}`} key={index}><strong>{item.role === "user" ? "You" : "Curator"}</strong><p>{item.content}</p></article>)}
              {busy === "chat" && <div className="playlist-chat-working" role="status"><LoaderCircle className="spin" /><span>Exploring your library and shaping the mix…</span></div>}
              {busy === "load" && <div className="playlist-chat-working" role="status"><LoaderCircle className="spin" />Loading your conversation…</div>}
            </div>
            {error && <p className="playlist-chat-error" role="alert">{error}</p>}
            {notice && <p className="playlist-chat-notice" role="status">{notice}</p>}
            <form className="playlist-chat-composer" onSubmit={send}>
              <label htmlFor="playlist-chat-message">{items.length ? "What would you change?" : "Your musical direction"}</label>
              <textarea id="playlist-chat-message" ref={input} value={message} maxLength={3000} rows={3} disabled={Boolean(busy)} onChange={event => setMessage(event.target.value)} placeholder={items.length ? "Keep the opener, make it calmer, and add more piano…" : "Describe your playlist…"} required />
              <div><label htmlFor="playlist-chat-count">Songs <input id="playlist-chat-count" type="number" min={1} max={100} value={targetTracks} disabled={Boolean(busy)} onChange={event => setTargetTracks(Number(event.target.value))} required /></label><button className="primary-button" disabled={Boolean(busy) || !message.trim() || targetTracks < 1 || targetTracks > 100}><Send />{busy === "chat" ? "Working…" : items.length ? "Update playlist" : "Make playlist"}</button></div>
            </form>
          </div>
          <aside className="playlist-chat-songs" aria-label="Selected songs">
            <header><div><h3>Your mix</h3><small>{items.length ? `${items.length} songs · ${definition?.navidromePlaylistId ? "Linked to Navidrome" : "Draft"}` : "Songs will appear here"}</small></div>{state?.result && <small>{Math.round(state.result.detail.durationMs / 1000)}s</small>}</header>
            <div className="preview-track-list">{items.map((item,index) => <article key={item.fileId}><span>{index+1}</span><div><strong>{item.title}</strong><small>{item.artist} · {item.album}</small><em>{item.reason}</em></div></article>)}</div>
            {state?.result && state.result.detail.pending > 0 && <p className="playlist-chat-shortage">{state.result.detail.pending} more songs needed. Try broadening your request before publishing.</p>}
            <footer><button className="secondary-button" disabled={Boolean(busy) || !items.length || Boolean(state?.result?.detail.pending) || definition?.ownerTokenStatus !== "active"} onClick={() => void sync()}><RefreshCw />{busy === "sync" ? "Saving…" : definition?.navidromePlaylistId ? "Apply draft to Navidrome" : "Save to Navidrome"}</button></footer>
          </aside>
        </div>
      </section>
    </div>
  );
}
