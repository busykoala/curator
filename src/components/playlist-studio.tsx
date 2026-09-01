"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  getMeta,
  type PlaylistData,
  type PlaylistDefinition,
  type PlaylistPreview,
} from "./playlist-view-model";

async function json(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error || "Request failed (" + response.status + ")");
  }
  return body;
}

function template(category: "mood" | "discovery" | "journey") {
  return {
    name: "",
    category,
    enabled: true,
    intent: "",
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

  const load = useCallback(async () => {
    try {
      setData((await json(await fetch("/api/playlists"))) as PlaylistData);
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function save(value: PlaylistDefinition) {
    setBusy("save");
    try {
      const path = value.id ? "/api/playlists/" + value.id : "/api/playlists";
      await json(
        await fetch(path, {
          method: value.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
      setEditor(undefined);
      setNotice("Playlist saved. Curator will maintain it automatically.");
      await load();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy("");
    }
  }

  async function remove(item: PlaylistDefinition) {
    if (!item.id || !window.confirm("Remove " + item.name + "?")) return;
    try {
      await json(
        await fetch("/api/playlists/" + item.id, { method: "DELETE" }),
      );
      setNotice(item.name + " was removed from Curator and Navidrome.");
      await load();
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function run(item: PlaylistDefinition, previewOnly: boolean) {
    if (!item.id) return;
    setBusy((previewOnly ? "preview-" : "sync-") + item.id);
    try {
      const result = await json(
        await fetch("/api/playlists/" + item.id + "/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preview: previewOnly }),
        }),
      );
      if (previewOnly) setPreview(result);
      else {
        setNotice(item.name + " is synchronized with Navidrome.");
        await load();
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
      await json(
        await fetch("/api/playlists/" + item.id, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !item.enabled }),
        }),
      );
      await load();
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
    await json(
      await fetch("/api/playlists/" + playlistId + "/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId, artist, action }),
      }),
    );
    setNotice("Preference saved for the next refresh.");
  }

  if (!data) {
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
            disabled={Boolean(busy) || !connectionConfigured}
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
        <a
          className="secondary-button"
          href="http://localhost:4533/app/#/playlist"
          target="_blank"
        >
          <ExternalLink />
          Navidrome
        </a>
      </header>

      {!connectionConfigured && (
        <div className="playlist-connection">
          <Ban />
          <div>
            <strong>Navidrome is not connected</strong>
            <span>Add the admin credentials before synchronizing playlists.</span>
          </div>
        </div>
      )}

      {notice && (
        <div className="playlist-notice">
          <span>{notice}</span>
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
          <button onClick={() => setEditor(template("mood"))}>
            <span><Plus /></span>
            <strong>Mood or occasion</strong>
            <small>Choose feelings, context, and sound.</small>
          </button>
          <button onClick={() => setEditor(template("discovery"))}>
            <span><Compass /></span>
            <strong>Discovery lane</strong>
            <small>Give Curator a genre, subgenre, or theme.</small>
          </button>
          <button onClick={() => setEditor(template("journey"))}>
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
            <h2>Your playlists</h2>
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
          <section className="playlist-preview-drawer">
            <header>
              <div>
                <span className="kicker">Preview</span>
                <h2>{preview.definition.name}</h2>
                <p>{preview.items.length} tracks in proposed order</p>
              </div>
              <button className="icon-button" onClick={() => setPreview(undefined)}>
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
          close={() => setEditor(undefined)}
          save={save}
        />
      )}
    </div>
  );
}
