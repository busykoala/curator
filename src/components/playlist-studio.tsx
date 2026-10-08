"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, MoreHorizontal, Plus, ArrowRight } from "lucide-react";
import {
  defaultConfig,
  type PlaylistCategory,
} from "@/features/playlists/types";
import { useListener } from "./app-shell";
import { ActionSheet } from "./action-sheet";
import { PlaylistChat } from "./playlist-chat";
import { PlaylistEditor } from "./playlist-editor";
import {
  getMeta,
  type PlaylistData,
  type PlaylistDefinition,
  type PlaylistPreview,
} from "./playlist-view-model";
import { playlistStatus } from "./playlist-status";
import {
  BackLink,
  Loading,
  Notice,
  PageHeader,
  entityHref,
  nativePlaylistHref,
} from "./ui";
import { readJson } from "./http";
const creationTypes = [
  "chat",
  "mood",
  "rediscovery",
  "depth",
  "journey",
  "discovery",
] as const;
type Snapshot = PlaylistPreview & {
  preview: boolean;
  runId: number | null;
  latestRun?: { status: string };
  stale?: boolean;
};
export function PlaylistStudio({
  id,
  createType,
  chooseType = false,
  editing = false,
}: {
  id?: number;
  createType?: string;
  chooseType?: boolean;
  editing?: boolean;
}) {
  const { user } = useListener(),
    router = useRouter(),
    params = useSearchParams();
  const [data, setData] = useState<PlaylistData>(),
    [snapshot, setSnapshot] = useState<Snapshot>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState<PlaylistDefinition>(),
    [deleteItem, setDeleteItem] = useState<PlaylistDefinition>(),
    [rename, setRename] = useState<PlaylistDefinition>(),
    [feedback, setFeedback] = useState<number>();
  const load = useCallback(async () => {
    try {
      if (id)
        setSnapshot(
          await readJson<Snapshot>(
            await fetch("/api/playlists/" + id, { cache: "no-store" }),
          ),
        );
      else
        setData(
          await readJson<PlaylistData>(
            await fetch("/api/playlists", { cache: "no-store" }),
          ),
        );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playlists unavailable");
    }
  }, [id]);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  async function save(value: PlaylistDefinition) {
    const result = await readJson<{ playlist: PlaylistDefinition }>(
      await fetch(value.id ? "/api/playlists/" + value.id : "/api/playlists", {
        method: value.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      }),
    );
    if (!value.id) await run(result.playlist, true);
    router.push("/playlists/" + result.playlist.id);
  }
  async function run(item: PlaylistDefinition, preview: boolean) {
    setBusy(true);
    setError("");
    try {
      const next = await readJson<PlaylistPreview>(
        await fetch("/api/playlists/" + item.id + "/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preview,
            ...(!preview && snapshot?.preview && snapshot.runId
              ? { previewRunId: snapshot.runId }
              : {}),
          }),
        }),
      );
      setSnapshot({ ...next, preview, runId: next.runId ?? null });
      setNotice(
        preview
          ? "New preview ready. Your saved playlist has not changed."
          : "Saved to Navidrome.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playlist update failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleteItem?.id) return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch("/api/playlists/" + deleteItem.id, { method: "DELETE" }),
      );
      setDeleteItem(undefined);
      if (id) router.push("/playlists");
      else await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Playlist could not be deleted",
      );
    } finally {
      setBusy(false);
    }
  }
  async function preference(action: string) {
    if (!feedback || !id) return;
    setBusy(true);
    try {
      const item = snapshot?.items.find((i) => i.fileId === feedback);
      await readJson(
        await fetch(`/api/playlists/${id}/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileId: feedback,
            artist: item?.artist ?? "",
            action,
          }),
        }),
      );
      setNotice("Preference saved for the next refresh.");
      setFeedback(undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Preference could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  const item = snapshot?.definition;
  if (chooseType)
    return (
      <>
        <BackLink href="/playlists">Playlists</BackLink>
        <PageHeader
          title="New playlist"
          description="Choose how you’d like to make it."
        />
        <div className="creation-options form-column">
          {creationTypes.map((type) => {
            const meta = getMeta(type),
              Icon = meta.icon;
            return (
              <Link
                className="creation-option"
                key={type}
                href={"/playlists/new/" + type}
              >
                <Icon />
                <span>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </span>
                <ArrowRight />
              </Link>
            );
          })}
        </div>
      </>
    );
  if (createType === "chat" || (item?.category === "chat" && !editing))
    return (
      <PlaylistChat
        key={id ?? "new"}
        initial={item}
        ownerUserId={user.id}
        close={() => router.push("/playlists")}
        changed={() => void load()}
        created={(newId) => router.replace("/playlists/" + newId)}
      />
    );
  if (createType || (editing && item)) {
    const category = (createType ??
        item?.category ??
        "mood") as PlaylistCategory,
      initial = item ?? {
        name: "",
        category,
        enabled: false,
        intent: "",
        ownerUserId: user.id,
        config: defaultConfig(category),
      };
    return (
      <>
        <BackLink href={id ? "/playlists/" + id : "/playlists/new"}>
          {id ? "Playlist" : "Playlist types"}
        </BackLink>
        <PageHeader
          title={id ? "Edit playlist settings" : getMeta(category).label}
        />
        <PlaylistEditor
          key={id ?? category}
          initial={initial}
          close={() => router.push(id ? "/playlists/" + id : "/playlists/new")}
          save={save}
          page
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={item?.name ?? (id ? "Playlist" : "Playlists")}
        description={
          id
            ? `${getMeta(item?.category ?? "mood").label} · ${Number(item?.config.targetTracks ?? 0)} songs`
            : "Your mixes, ready to shape and listen to."
        }
        actions={
          id ? (
            item && (
              <button
                className="icon-button"
                onClick={() => setMenu(item)}
                aria-label="Playlist options"
              >
                <MoreHorizontal />
              </button>
            )
          ) : (
            <Link className="primary-button" href="/playlists/new">
              <Plus />
              New playlist
            </Link>
          )
        }
      />
      {id && <BackLink href="/playlists">Playlists</BackLink>}
      {error && (
        <Notice error>
          {error}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </Notice>
      )}
      {params.get("native") === "unavailable" && (
        <Notice>
          The playlist could not be found in Navidrome.{" "}
          <a href="/api/navidrome/open" target="_blank" rel="noreferrer">
            Open Navidrome
          </a>
        </Notice>
      )}
      {snapshot?.latestRun?.status === "failed" && (
        <Notice error>
          The last update failed. Review your settings and try another preview.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {id ? (
        !snapshot ? (
          <Loading>Loading mix…</Loading>
        ) : (
          <>
            <div className="button-row playlist-detail-actions">
              {item?.navidromePlaylistId && (
                <a
                  className="primary-button"
                  href={nativePlaylistHref(id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Navidrome
                  <ExternalLink />
                </a>
              )}
              <Link
                className="secondary-button"
                href={"/playlists/" + id + "/edit"}
              >
                Edit settings
              </Link>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void run(item!, true)}
              >
                {busy ? "Preparing…" : "Preview new mix"}
              </button>
            </div>
            <p className="muted small">
              {snapshot.preview
                ? "Draft preview · Saved songs are unchanged"
                : item?.navidromePlaylistId
                  ? "Saved to Navidrome"
                  : "Draft"}
              {item?.enabled ? " · Refreshes nightly at 04:30 Zurich" : ""}
            </p>
            {!snapshot.items.length ? (
              <div className="empty-state">
                <h2>No songs selected yet</h2>
                <p>
                  Create a preview with the current settings to review your mix.
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void run(item!, true)}
                >
                  Create preview
                </button>
              </div>
            ) : (
              <>
                <div className="song-list">
                  {snapshot.items.map((song, index) => (
                    <article className="song-row" key={song.fileId}>
                      <span className="song-number">{index + 1}</span>
                      <div>
                        <Link
                          className="song-title"
                          href={entityHref("songs", song.fileId)}
                        >
                          {song.title}
                        </Link>
                        <div className="song-context">
                          <Link href={entityHref("artists", song.artist)}>
                            {song.artist}
                          </Link>{" "}
                          ·{" "}
                          {song.albumKey ? (
                            <Link href={entityHref("albums", song.albumKey)}>
                              {song.album}
                            </Link>
                          ) : (
                            song.album
                          )}
                        </div>
                        <details className="song-reason">
                          <summary>Why this song?</summary>
                          <p>{song.reason}</p>
                        </details>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={"Preferences for " + song.title}
                        onClick={() => setFeedback(song.fileId)}
                      >
                        <MoreHorizontal />
                      </button>
                    </article>
                  ))}
                </div>
                {snapshot.preview && (
                  <div className="playlist-save">
                    <p className="muted small">
                      {snapshot.stale
                        ? "Settings changed. Preview a new mix before saving."
                        : snapshot.items.length <
                            Number(item?.config.targetTracks)
                          ? "Fewer matching songs than requested. Broaden your settings or reduce the song count before saving."
                          : "Review your selection, then save it to Navidrome."}
                    </p>
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        snapshot.stale ||
                        snapshot.items.length <
                          Number(item?.config.targetTracks) ||
                        item?.ownerTokenStatus !== "active"
                      }
                      onClick={() => void run(item!, false)}
                    >
                      {busy
                        ? "Saving…"
                        : item?.navidromePlaylistId
                          ? "Save updated mix to Navidrome"
                          : "Save to Navidrome"}
                      <ExternalLink />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )
      ) : !data ? (
        <Loading>Loading your playlists…</Loading>
      ) : (
        <>
          {data.definitions.length ? (
            data.definitions.map((p) => (
              <article className="playlist-row" key={p.id}>
                <span className="playlist-row-icon">
                  {(() => {
                    const Icon = getMeta(p.category).icon;
                    return <Icon />;
                  })()}
                </span>
                <Link className="playlist-row-copy" href={"/playlists/" + p.id}>
                  <strong>
                    {p.category === "chat" &&
                    p.name.startsWith("Chat playlist ")
                      ? "New playlist"
                      : p.name}
                  </strong>
                  <span>
                    {getMeta(p.category).label} ·{" "}
                    {Number(p.config.targetTracks)} songs
                    {p.enabled ? " · Nightly refresh" : ""}
                  </span>
                  <small className={p.unreadReply ? "reply-ready" : ""}>
                    {playlistStatus(p)}
                  </small>
                </Link>
                <Link
                  className="text-link playlist-open"
                  href={"/playlists/" + p.id}
                >
                  {p.unreadReply ? "Read reply" : "Open"}
                </Link>
                <button
                  className="icon-button"
                  aria-label={"More actions for " + p.name}
                  onClick={() => setMenu(p)}
                >
                  <MoreHorizontal />
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <h2>Your first mix starts here</h2>
              <p>
                Describe what you’d like to hear, or choose a playlist type.
              </p>
              <Link className="primary-button" href="/playlists/new">
                New playlist
                <Plus />
              </Link>
            </div>
          )}
          <p className="muted small section">
            These playlists belong to your account. Music in the library is
            shared.
          </p>
        </>
      )}
      {menu && (
        <ActionSheet title={menu.name} close={() => setMenu(undefined)}>
          <div className="action-menu">
            {menu.category !== "chat" && (
              <Link href={"/playlists/" + menu.id + "/edit"}>
                Selection settings and nightly refresh
                <ArrowRight />
              </Link>
            )}
            <button
              onClick={() => {
                setRename(menu);
                setMenu(undefined);
              }}
            >
              Rename
              <ArrowRight />
            </button>
            <button
              disabled={
                menu.chatJob?.status === "running" ||
                menu.chatJob?.status === "queued"
              }
              onClick={() => {
                setDeleteItem(menu);
                setMenu(undefined);
              }}
            >
              Delete playlist
              <ArrowRight />
            </button>
          </div>
        </ActionSheet>
      )}
      {rename && (
        <ActionSheet title="Rename playlist" close={() => setRename(undefined)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await readJson(
                  await fetch("/api/playlists/" + rename.id, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name: rename.name }),
                  }),
                );
                setRename(undefined);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Rename failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              <span>Playlist name</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={rename.name}
                onChange={(e) => setRename({ ...rename, name: e.target.value })}
              />
            </label>
            <p className="muted small">
              The new name is applied in Navidrome on the next saved update.
            </p>
            <button className="primary-button" disabled={busy}>
              Save name
            </button>
            {error && <Notice error>{error}</Notice>}
          </form>
        </ActionSheet>
      )}
      {deleteItem && (
        <ActionSheet
          title={"Delete " + deleteItem.name + "?"}
          close={() => !busy && setDeleteItem(undefined)}
        >
          <p>
            This removes the playlist from Curator and Navidrome. Your music
            files remain in the library.
          </p>
          {error && <Notice error>{error}</Notice>}
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setDeleteItem(undefined)}
            >
              Keep playlist
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "Deleting…" : "Delete playlist"}
            </button>
          </div>
        </ActionSheet>
      )}
      {feedback && (
        <ActionSheet
          title="Song preferences"
          close={() => setFeedback(undefined)}
        >
          <div className="action-menu">
            <button disabled={busy} onClick={() => void preference("pin")}>
              Keep in this mix
            </button>
            <button disabled={busy} onClick={() => void preference("exclude")}>
              Leave out of this mix
            </button>
            <button disabled={busy} onClick={() => void preference("snooze")}>
              Snooze from my mixes for 30 days
            </button>
          </div>
        </ActionSheet>
      )}
    </>
  );
}
