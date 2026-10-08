"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  MessageCircle,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pause,
  Pin,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  defaultConfig,
  type PlaylistCategory,
} from "@/features/playlists/types";
import { PlaylistChat } from "./playlist-chat";
import { PlaylistEditor } from "./playlist-editor";
import { readJson } from "./http";
import {
  getMeta,
  type PlaylistData,
  type PlaylistDefinition,
  type PlaylistPreview,
} from "./playlist-view-model";

const creationTypes = [
  "chat",
  "mood",
  "rediscovery",
  "depth",
  "journey",
  "discovery",
] as const;

function template(
  category: Exclude<PlaylistCategory, "chat">,
  ownerUserId: number,
): PlaylistDefinition {
  return {
    name: "",
    category,
    enabled: false,
    intent: "",
    ownerUserId,
    config: defaultConfig(category),
  };
}

export function PlaylistStudio() {
  const [data, setData] = useState<PlaylistData>();
  const [editor, setEditor] = useState<PlaylistDefinition>();
  const [chat, setChat] = useState<{ initial?: PlaylistDefinition }>();
  const [preview, setPreview] = useState<PlaylistPreview>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const [currentUserId, setCurrentUserId] = useState(0);
  const [undo, setUndo] = useState<{
    playlistId: number;
    fileId: number;
    artist: string;
    action: string;
  } | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (ownerUserId: number) => {
    if (!ownerUserId) return;
    const activeRequest = ++requestId.current;
    try {
      const playlists = await readJson<PlaylistData>(
        await fetch(`/api/playlists?userId=${ownerUserId}`, {
          cache: "no-store",
        }),
        "Playlists could not be loaded",
      );
      if (activeRequest !== requestId.current) return;
      setData(playlists);
    } catch (error) {
      if (activeRequest === requestId.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "Playlists could not be loaded",
        );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = await readJson<{
          user: { id: number };
          users: Array<{
            id: number;
            displayName: string;
            tokenStatus: string;
          }>;
        }>(
          await fetch("/api/session", { cache: "no-store" }),
          "Session could not be loaded",
        );
        const selected = session.user.id;
        setCurrentUserId(selected);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Session could not be loaded",
        );
      }
    })();
  }, []);
  useEffect(() => {
    if (!currentUserId) return;
    setData(undefined);
    setEditor(undefined);
    setPreview(undefined);
    setChat(undefined);
    void load(currentUserId);
    const timer = window.setInterval(() => void load(currentUserId), 30_000);
    return () => window.clearInterval(timer);
  }, [currentUserId, load]);
  useEffect(() => {
    if (!preview) return;
    const escape = (event: KeyboardEvent) =>
      event.key === "Escape" && setPreview(undefined);
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [preview]);

  async function save(value: PlaylistDefinition) {
    setBusy("save");
    try {
      const path = value.id ? "/api/playlists/" + value.id : "/api/playlists";
      const result = await readJson<{ playlist: PlaylistDefinition }>(
        await fetch(path, {
          method: value.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
      setEditor(undefined);
      setNotice(
        value.id
          ? "Playlist saved. " +
              (value.enabled
                ? "Nightly refresh is on."
                : "Refresh it whenever you like.")
          : "Playlist created. Preparing your preview…",
      );
      await load(currentUserId);
      if (!value.id) await run(result.playlist, true);
    } finally {
      setBusy("");
    }
  }

  async function remove(item: PlaylistDefinition) {
    if (
      !item.id ||
      !window.confirm("Remove " + item.name + " from Curator and Navidrome?")
    )
      return;
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
    if (item.category === "chat" && previewOnly) {
      setChat({ initial: item });
      return;
    }
    setBusy((previewOnly ? "preview-" : "sync-") + item.id);
    try {
      const result = await readJson<PlaylistPreview>(
        await fetch("/api/playlists/" + item.id + "/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preview: previewOnly }),
        }),
      );
      if (previewOnly) {
        setPreview(result);
        setNotice("");
      } else {
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
    try {
      await readJson(
        await fetch("/api/playlists/" + playlistId + "/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId, artist, action }),
        }),
      );
      setUndo({ playlistId, fileId, artist, action });
      setNotice("Preference saved for the next refresh.");
    } catch (error) {
      setNotice(String(error));
    }
  }
  async function undoFeedback() {
    if (!undo) return;
    try {
      await readJson(
        await fetch(`/api/playlists/${undo.playlistId}/feedback`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(undo),
        }),
      );
      setNotice("Preference undone.");
      setUndo(null);
    } catch (error) {
      setNotice(String(error));
    }
  }

  if (!data) {
    if (notice)
      return (
        <div className="empty-state">
          <Ban />
          <h3>Playlists could not be loaded</h3>
          <p>{notice}</p>
          <button
            className="primary-button"
            onClick={() => void load(currentUserId)}
          >
            Retry
          </button>
        </div>
      );
    return (
      <div className="playlist-loading">
        <LoaderCircle className="spin" />
        <span>Preparing your playlists…</span>
      </div>
    );
  }

  const connectionConfigured = data.connection.configured;
  const enabled = data.definitions.filter(
    (item) => item.enabled && item.category !== "chat",
  ).length;
  const playlists = [...data.definitions].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  function row(item: PlaylistDefinition) {
    const meta = getMeta(item.category);
    const Icon = meta.icon;
    const latest = item.runs?.[0];
    return (
      <article className="playlist-row" key={item.id}>
        <span className="playlist-row-icon">
          <Icon />
        </span>
        <div className="playlist-row-copy">
          <span>{meta.label}</span>
          <h3>{item.name}</h3>
          <p>
            {item.category === "discovery" || item.category === "chat"
              ? item.intent || meta.description
              : meta.description}
          </p>
        </div>
        <div className="playlist-row-facts">
          <span>
            <strong>{Number(item.config.targetTracks ?? 30)}</strong>
            tracks
          </span>
          <span>
            <strong>
              {item.category === "chat"
                ? "Chat"
                : Number(item.config.rotationPercent ?? 30) + "%"}
            </strong>
            {item.category === "chat" ? "updates" : "change per refresh"}
          </span>
          <span>
            <strong>
              {item.chatJob?.status === "queued"
                ? "Queued"
                : item.chatJob?.status === "running"
                  ? "Working"
                  : item.chatJob?.status === "completed"
                    ? "Reply ready"
                    : item.chatJob?.status === "failed"
                      ? "Needs retry"
                      : latest?.status || "Ready"}
            </strong>
            last result
          </span>
        </div>
        <div className="playlist-row-actions">
          {item.category !== "chat" && (
            <button
              className={"playlist-toggle " + (item.enabled ? "on" : "")}
              disabled={Boolean(busy)}
              aria-label={`${item.enabled ? "Pause" : "Enable"} nightly refresh for ${item.name}`}
              title={
                item.enabled
                  ? "Pause nightly refresh"
                  : "Enable nightly refresh"
              }
              aria-pressed={item.enabled}
              onClick={() => void toggle(item)}
            >
              {item.enabled ? <Pause /> : <Play />}
              {item.enabled ? "Nightly" : "Manual"}
            </button>
          )}
          {item.category === "chat" && (
            <button
              className="playlist-main-action"
              aria-label={`Chat about ${item.name}`}
              title="Continue playlist chat"
              onClick={() => setChat({ initial: item })}
            >
              <MessageCircle />
              Open chat
            </button>
          )}
          {item.category !== "chat" && (
            <button
              aria-label={`Edit ${item.name}`}
              title="Edit playlist"
              disabled={Boolean(busy)}
              onClick={() => setEditor(item)}
            >
              <SlidersHorizontal />
            </button>
          )}
          {item.category !== "chat" && (
            <button
              className="playlist-main-action"
              aria-label={`Preview ${item.name}`}
              title="Preview playlist"
              disabled={Boolean(busy)}
              onClick={() => void run(item, true)}
            >
              {busy === "preview-" + item.id ? (
                <LoaderCircle className="spin" />
              ) : (
                <Sparkles />
              )}
              Preview
            </button>
          )}
          <button
            aria-label={`Synchronize ${item.name}`}
            title={
              item.category === "chat"
                ? "Sync saved mix to Navidrome"
                : item.navidromePlaylistId
                  ? "Refresh mix in Navidrome"
                  : "Publish to Navidrome"
            }
            disabled={
              Boolean(busy) ||
              item.ownerTokenStatus !== "active" ||
              item.chatJob?.status === "queued" ||
              item.chatJob?.status === "running"
            }
            onClick={() => void run(item, false)}
          >
            <RefreshCw />
          </button>
          <button
            className="danger-icon"
            aria-label={`Remove ${item.name}`}
            title="Remove playlist"
            disabled={
              Boolean(busy) ||
              item.chatJob?.status === "queued" ||
              item.chatJob?.status === "running"
            }
            onClick={() => void remove(item)}
          >
            <Trash2 />
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="playlist-studio playlist-studio-v2">
      <header className="playlist-page-head">
        <div>
          <span className="kicker">Your playlist studio</span>
          <h2>Your library, kept in motion</h2>
          <p>
            Explore your collection, rediscover favorites, or shape a mix in
            conversation.
          </p>
        </div>
        <div className="playlist-user-tools">
          <span>Playlists for {data.selectedUser.displayName}</span>
          <a
            className="secondary-button"
            href="/api/navidrome/open"
            target="_blank"
          >
            <ExternalLink />
            Navidrome
          </a>
        </div>
      </header>

      {!connectionConfigured && (
        <div className="playlist-connection">
          <Ban />
          <div>
            <strong>Navidrome is not connected</strong>
            <span>
              The playlist owner must sign into Curator with Navidrome before
              synchronization.
            </span>
          </div>
        </div>
      )}

      {notice && (
        <div className="playlist-notice">
          <span>{notice}</span>
          {undo && (
            <button className="notice-undo" onClick={() => void undoFeedback()}>
              Undo
            </button>
          )}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X />
          </button>
        </div>
      )}

      <section className="playlist-statusbar">
        <div>
          <span className="status-pulse" />
          <strong>{enabled} refresh nightly</strong>
          <span>· {data.definitions.length} playlists in total</span>
        </div>
        <div>
          <Clock3 />
          <span>Nightly refresh</span>
          <strong>{enabled ? "04:30 Zurich" : "Manual"}</strong>
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
            Choose how to shape your mix. Start with your own direction or
            browse optional ideas before creating a playlist.
          </p>
        </header>
        <div>
          {creationTypes.map((category) => {
            const meta = getMeta(category),
              Icon = meta.icon;
            return (
              <button
                key={category}
                onClick={() =>
                  category === "chat"
                    ? setChat({})
                    : setEditor(template(category, currentUserId))
                }
              >
                <span>
                  <Icon />
                </span>
                <strong>{meta.label}</strong>
                <small>{meta.description}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="playlist-list-section"
        aria-labelledby="your-playlists-title"
      >
        <header>
          <div>
            <h2 id="your-playlists-title">Your playlists</h2>
            <p>
              Refine chat playlists through conversation. Preview, edit, or
              refresh your other mixes whenever you like.
            </p>
          </div>
          <span>{playlists.length} playlists</span>
        </header>
        <div className="playlist-row-list">{playlists.map(row)}</div>
        {!playlists.length && (
          <p className="playlist-group-empty">
            Choose a playlist type above to create your first mix. Starting
            ideas are optional, and nightly refresh is your choice.
          </p>
        )}
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
          <section
            className="playlist-preview-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="playlist-preview-title"
          >
            <header>
              <div>
                <span className="kicker">Preview</span>
                <h2 id="playlist-preview-title">{preview.definition.name}</h2>
                <p>
                  {preview.items.length} of{" "}
                  {Number(preview.definition.config.targetTracks)} songs in
                  proposed order
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close playlist preview"
                onClick={() => setPreview(undefined)}
              >
                <X />
              </button>
            </header>
            {preview.items.length > 0 &&
              preview.items.length <
                Number(preview.definition.config.targetTracks) && (
                <p className="playlist-group-empty">
                  This direction has fewer matching songs than requested.
                  Broaden your settings or reduce the song count before
                  publishing.
                </p>
              )}
            {!preview.items.length && (
              <p className="playlist-group-empty">
                No songs match this direction yet. Adjust the settings or choose
                a broader sound.
              </p>
            )}
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
            <footer className="playlist-preview-actions">
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setEditor(preview.definition);
                  setPreview(undefined);
                }}
              >
                Adjust settings
              </button>
              <button
                className="primary-button"
                disabled={
                  Boolean(busy) ||
                  preview.items.length <
                    Number(preview.definition.config.targetTracks) ||
                  preview.definition.ownerTokenStatus !== "active"
                }
                onClick={() => {
                  const definition = preview.definition;
                  setPreview(undefined);
                  void run(definition, false);
                }}
              >
                <ExternalLink />
                {preview.definition.navidromePlaylistId
                  ? "Refresh in Navidrome"
                  : "Publish to Navidrome"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {chat && (
        <PlaylistChat
          initial={chat.initial}
          ownerUserId={currentUserId}
          close={() => setChat(undefined)}
          changed={() => void load(currentUserId)}
        />
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
