"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  Clock3,
  Compass,
  ExternalLink,
  LoaderCircle,
  Pause,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { PlaylistEditor } from "./playlist-editor";
import { readJson } from "./http";
import {
  getMeta,
  type PlaylistData,
  type PlaylistDefinition,
  type PlaylistPreview,
} from "./playlist-view-model";

function template(category: "mood" | "discovery" | "journey", ownerUserId: number) {
  return {
    name: "",
    category,
    enabled: true,
    intent: "",
    ownerUserId,
    config: {
      tasteLanes: [],
      genres: [],
      moods: [],
      contexts: [],
      exclusions: [],
      sourceDomains: [],
      targetTracks:
        category === "mood" ? 40 : category === "journey" ? 16 : 24,
      rotationPercent: 30,
      maxTracksPerArtist: 2,
      maxTracksPerAlbum: 1,
      energyCurve: category === "journey" ? "slow_burn" : "steady",
      explorationPercent: 35,
      externalDiscovery: category === "discovery",
      noveltyDays: 30,
    },
  } satisfies PlaylistDefinition;
}

export function PlaylistStudio() {
  const [data, setData] = useState<PlaylistData>();
  const [editor, setEditor] = useState<PlaylistDefinition>();
  const [preview, setPreview] = useState<PlaylistPreview>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [users,setUsers]=useState<Array<{id:number;displayName:string;tokenStatus:string}>>([]);
  const [currentUserId,setCurrentUserId]=useState(0);
  const [undo,setUndo]=useState<{playlistId:number;fileId:number;artist:string;action:string}|null>(null);
  const requestId=useRef(0);

  const load = useCallback(async (ownerUserId: number) => {
    if(!ownerUserId)return;
    const activeRequest=++requestId.current;
    try {
      const playlists=await readJson<PlaylistData>(await fetch(`/api/playlists?userId=${ownerUserId}`,{cache:"no-store"}),"Playlists could not be loaded");
      if(activeRequest!==requestId.current)return;
      setData(playlists);setUsers(playlists.users);
      if(playlists.automaticWarning)setNotice(`Automatic playlists were not refreshed: ${playlists.automaticWarning}`);
    } catch (error) {
      if(activeRequest===requestId.current)setNotice(error instanceof Error?error.message:"Playlists could not be loaded");
    }
  }, []);

  useEffect(() => {
    void (async()=>{try{const session=await readJson<{user:{id:number};users:Array<{id:number;displayName:string;tokenStatus:string}>}>(await fetch("/api/session",{cache:"no-store"}),"Session could not be loaded");const requested=Number(new URLSearchParams(window.location.search).get("userId"));const selected=session.users.some(user=>user.id===requested)?requested:session.user.id;setUsers(session.users);setCurrentUserId(selected)}catch(error){setNotice(error instanceof Error?error.message:"Session could not be loaded")}})();
  }, []);
  useEffect(() => {
    if(!currentUserId)return;
    setData(undefined);setEditor(undefined);setPreview(undefined);
    void load(currentUserId);
    const timer = window.setInterval(() => void load(currentUserId), 30_000);
    return () => window.clearInterval(timer);
  }, [currentUserId,load]);
  useEffect(()=>{if(!preview)return;const escape=(event:KeyboardEvent)=>event.key==="Escape"&&setPreview(undefined);window.addEventListener("keydown",escape);return()=>window.removeEventListener("keydown",escape)},[preview]);

  async function save(value: PlaylistDefinition) {
    setBusy("save");
    try {
      const path = value.id ? "/api/playlists/" + value.id : "/api/playlists";
      await readJson(
        await fetch(path, {
          method: value.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
      setEditor(undefined);
      setNotice("Playlist saved. Curator will maintain it automatically.");
      await load(currentUserId);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy("");
    }
  }

  async function remove(item: PlaylistDefinition) {
    if (!item.id || !window.confirm("Remove " + item.name + "?")) return;
    try {
      await readJson(
        await fetch("/api/playlists/" + item.id, { method: "DELETE" }),
      );
      setNotice(item.name + " was removed from Curator and Navidrome.");
      await load(currentUserId);
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function run(item: PlaylistDefinition, previewOnly: boolean) {
    if (!item.id) return;
    setBusy((previewOnly ? "preview-" : "sync-") + item.id);
    try {
      const result = await readJson<PlaylistPreview>(
        await fetch("/api/playlists/" + item.id + "/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preview: previewOnly }),
        }),
      );
      if (previewOnly) setPreview(result);
      else {
        setNotice(item.name + " is synchronized with Navidrome.");
        await load(currentUserId);
      }
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy("");
    }
  }

  async function toggle(item: PlaylistDefinition) {
    if (!item.id) return;
    try {
      await readJson(
        await fetch("/api/playlists/" + item.id, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !item.enabled }),
        }),
      );
      await load(currentUserId);
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function feedback(
    playlistId: number | undefined,
    fileId: number,
    artist: string,
    action: string,
  ) {
    if (!playlistId) return;
    try { await readJson(await fetch("/api/playlists/" + playlistId + "/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId, artist, action }),
      })); setUndo({playlistId,fileId,artist,action}); setNotice("Preference saved for the next refresh."); }
    catch(error){setNotice(String(error))}
  }
  async function undoFeedback(){if(!undo)return;try{await readJson(await fetch(`/api/playlists/${undo.playlistId}/feedback`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify(undo)}));setNotice("Preference undone.");setUndo(null)}catch(error){setNotice(String(error))}}

  if (!data) {
    if(notice)return <div className="empty-state"><Ban/><h3>Playlists could not be loaded</h3><p>{notice}</p><button className="primary-button" onClick={()=>void load(currentUserId)}>Retry</button></div>;
    return (
      <div className="playlist-loading">
        <LoaderCircle className="spin" />
        <span>Preparing your playlists…</span>
      </div>
    );
  }

  const connectionConfigured = data.connection.configured;
  const enabled = data.definitions.filter((item) => item.enabled).length;
  const playlists = [...data.definitions].sort((left, right) => {
    const leftManaged =
      left.category === "depth" || left.category === "rediscovery";
    const rightManaged =
      right.category === "depth" || right.category === "rediscovery";
    return Number(rightManaged) - Number(leftManaged) ||
      left.name.localeCompare(right.name);
  });

  function row(item: PlaylistDefinition) {
    const managed =
      item.category === "depth" || item.category === "rediscovery";
    const meta = getMeta(item.category);
    const Icon = meta.icon;
    const latest = item.runs?.[0];
    return (
      <article className="playlist-row" key={item.id}>
        <span className="playlist-row-icon">
          <Icon />
        </span>
        <div className="playlist-row-copy">
          <span>
            {managed ? "Automatic · " + meta.label : meta.label}
          </span>
          <h3>{item.name}</h3>
          <p>
            {item.intent ||
              (managed
                ? "Built from listening patterns and library connections."
                : meta.description)}
          </p>
        </div>
        <div className="playlist-row-facts">
          <span><strong>{item.ownerDisplayName||"Unassigned"}</strong>owner</span>
          <span>
            <strong>{Number(item.config.targetTracks ?? 30)}</strong>
            tracks
          </span>
          <span>
            <strong>{Number(item.config.rotationPercent ?? 30)}%</strong>
            nightly change
          </span>
          <span>
            <strong>{latest?.status || "Ready"}</strong>
            last result
          </span>
        </div>
        <div className="playlist-row-actions">
          <button
            className={"playlist-toggle " + (item.enabled ? "on" : "")}
            onClick={() => void toggle(item)}
          >
            {item.enabled ? <Pause /> : <Play />}
            {item.enabled ? "On" : "Off"}
          </button>
          {!managed && (
            <button aria-label={`Edit ${item.name}`} title="Edit playlist" onClick={() => setEditor(item)}>
              <SlidersHorizontal />
            </button>
          )}
          <button
            aria-label={`Preview ${item.name}`}
            title="Preview playlist"
            disabled={Boolean(busy)}
            onClick={() => void run(item, true)}
          >
            <Sparkles />
          </button>
          <button
            aria-label={`Synchronize ${item.name}`}
            title="Synchronize now"
            disabled={Boolean(busy) || item.ownerTokenStatus !== "active"}
            onClick={() => void run(item, false)}
          >
            <RefreshCw />
          </button>
          {!managed && (
            <button
              className="danger-icon"
              aria-label={`Remove ${item.name}`}
              title="Remove playlist"
              onClick={() => void remove(item)}
            >
              <Trash2 />
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="playlist-studio playlist-studio-v2">
      <header className="playlist-page-head">
        <div>
          <span className="kicker">Automatic nightly playlists</span>
          <h2>Your library, kept in motion</h2>
          <p>
            Curator handles the defaults. Add only the moods and directions
            that are personal to you.
          </p>
        </div>
        <div className="playlist-user-tools"><label><span>Playlists for</span><select value={currentUserId} onChange={event=>{const id=Number(event.target.value);setCurrentUserId(id);const url=new URL(window.location.href);url.searchParams.set("userId",String(id));window.history.replaceState({},"",url)} }>{users.map(user=><option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label><a className="secondary-button" href="/api/navidrome/open" target="_blank"><ExternalLink />Navidrome</a></div>
      </header>

      {!connectionConfigured && (
        <div className="playlist-connection">
          <Ban />
          <div>
            <strong>Navidrome is not connected</strong>
            <span>The playlist owner must sign into Curator with Navidrome before synchronization.</span>
          </div>
        </div>
      )}

      {notice && (
        <div className="playlist-notice">
          <span>{notice}</span>
          {undo&&<button className="notice-undo" onClick={()=>void undoFeedback()}>Undo</button>}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X />
          </button>
        </div>
      )}

      <section className="playlist-statusbar">
        <div>
          <span className="status-pulse" />
          <strong>{enabled} active</strong>
          <span>of {data.definitions.length} playlists</span>
        </div>
        <div>
          <Clock3 />
          <span>Next refresh</span>
          <strong>04:30</strong>
        </div>
        <div>
          <RefreshCw />
          <span>Last run</span>
          <strong>{data.schedule.lastRun || "Not yet"}</strong>
        </div>
      </section>

      <section className="playlist-create-panel">
        <header>
          <span className="kicker">Add your direction</span>
          <h2>What do you want to hear?</h2>
          <p>
            Pick a starting point. The next step offers options found in your
            library, while still allowing your own terms.
          </p>
        </header>
        <div>
          <button onClick={() => setEditor(template("mood",currentUserId))}>
            <span><Plus /></span>
            <strong>Mood or occasion</strong>
            <small>Choose feelings, context, and sound.</small>
          </button>
          <button onClick={() => setEditor(template("discovery",currentUserId))}>
            <span><Compass /></span>
            <strong>Discovery lane</strong>
            <small>Give Curator a genre, subgenre, or theme.</small>
          </button>
          <button onClick={() => setEditor(template("journey",currentUserId))}>
            <span><Route /></span>
            <strong>Progressive journey</strong>
            <small>Choose a direction and energy arc.</small>
          </button>
        </div>
      </section>

      <section className="playlist-list-section">
        <header>
          <div>
            <span className="kicker">Managed collection</span>
            <h2>Playlists for {data.selectedUser.displayName}</h2>
          </div>
          <span>{playlists.length} total</span>
        </header>
        <div className="playlist-row-list">
          {playlists.map(row)}
        </div>
      </section>

      {data.acquisitions.length > 0 && (
        <details className="playlist-acquisitions playlist-acquisitions-v2">
          <summary>{data.acquisitions.length} discovery acquisitions</summary>
          {data.acquisitions.map((item) => (
            <div key={String(item.id)}>
              <strong>
                {String(item.artist)} · {String(item.album)}
              </strong>
              <span>
                {String(item.lane)} · {String(item.status)}
              </span>
            </div>
          ))}
        </details>
      )}

      {preview && (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(undefined);
          }}
        >
          <section className="playlist-preview-drawer" role="dialog" aria-modal="true" aria-labelledby="playlist-preview-title">
            <header>
              <div>
                <span className="kicker">Preview</span>
                <h2 id="playlist-preview-title">{preview.definition.name}</h2>
                <p>{preview.items.length} tracks in proposed order</p>
              </div>
              <button className="icon-button" aria-label="Close playlist preview" onClick={() => setPreview(undefined)}>
                <X />
              </button>
            </header>
            <div className="preview-track-list">
              {preview.items.map((item, index) => (
                <article key={item.fileId + "-" + index}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.artist} · {item.album}
                    </small>
                    <em>
                      {item.retained ? "Kept from last mix" : item.reason}
                      {item.profile?.energy
                        ? " · " + String(item.profile.energy)
                        : ""}
                      {item.profile?.bpm
                        ? " · " + String(item.profile.bpm) + " BPM"
                        : ""}
                    </em>
                  </div>
                  <div>
                    <button
                      title="Keep here"
                      onClick={() =>
                        void feedback(
                          preview.definition.id,
                          item.fileId,
                          item.artist,
                          "pin",
                        )
                      }
                    >
                      <Pin />
                    </button>
                    <button
                      title="Exclude here"
                      onClick={() =>
                        void feedback(
                          preview.definition.id,
                          item.fileId,
                          item.artist,
                          "exclude",
                        )
                      }
                    >
                      <Ban />
                    </button>
                    <button
                      title="Snooze everywhere for 30 days"
                      onClick={() =>
                        void feedback(
                          preview.definition.id,
                          item.fileId,
                          item.artist,
                          "snooze",
                        )
                      }
                    >
                      <Clock3 />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {editor && (
        <PlaylistEditor
          initial={editor}
          users={users}
          close={() => setEditor(undefined)}
          save={save}
        />
      )}
    </div>
  );
}
