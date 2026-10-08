"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Artwork,
  BackLink,
  PageHeader,
  Notice,
  entityHref,
  nativePlaylistHref,
} from "./ui";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  MessageCircle,
  Send,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { readJson } from "./http";
import {
  type PlaylistDefinition,
  type PreviewItem,
} from "./playlist-view-model";

type State = {
  definition: PlaylistDefinition;
  revision: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  result: {
    reply: string;
    items: PreviewItem[];
    detail: { durationMs: number; pending: number };
  } | null;
  synced?: boolean;
  syncError?: string;
  job?: {
    id: string;
    message: string;
    targetTracks: number;
    status: "queued" | "running" | "completed" | "failed";
    error: string;
    resultRevision: number | null;
    updatedAt: number;
  } | null;
};
type Submission = {
  requestId: string;
  message: string;
  targetTracks: number;
  revision: number;
};
const activeJob = (state?: State) =>
  state?.job?.status === "queued" || state?.job?.status === "running";
function cachedSubmission(key: string): Submission | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function cacheSubmission(key: string, value: Submission | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {}
}
type Props = {
  initial?: PlaylistDefinition;
  ownerUserId: number;
  close: () => void;
  changed: () => void;
  created?: (id: number) => void;
};

export function PlaylistChat({
  initial,
  ownerUserId,
  close,
  changed,
  created,
}: Props) {
  const [tab, setTab] = useState<"conversation" | "mix">("conversation");
  const createdRef = useRef(created);
  createdRef.current = created;
  const [state, setState] = useState<State>();
  const [definition, setDefinition] = useState(initial);
  const [message, setMessage] = useState("");
  const [targetTracks, setTargetTracks] = useState(
    Number(initial?.config.targetTracks ?? 20),
  );
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
  const readRevision = useRef(0);
  useEffect(() => {
    if (
      !state?.revision ||
      state.revision <= readRevision.current ||
      tab !== "conversation" ||
      document.visibilityState !== "visible"
    )
      return;
    void fetch(`/api/playlists/${state.definition.id}/chat/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: state.revision }),
    }).then((response) => {
      if (response.ok) readRevision.current = state.revision;
    });
  }, [state?.revision, tab]);

  const apply = useCallback((next: State) => {
    if (!mounted.current) return;
    const previous = stateRef.current;
    if (
      previous &&
      (next.revision < previous.revision ||
        (next.revision === previous.revision &&
          (next.job?.updatedAt ?? 0) < (previous.job?.updatedAt ?? 0)))
    )
      return;
    stateRef.current = next;
    setState(next);
    setDefinition(next.definition);
    if (!previous || next.revision !== previous.revision || activeJob(next))
      setTargetTracks(
        next.job && activeJob(next)
          ? next.job.targetTracks
          : Number(next.definition.config.targetTracks),
      );
    setError(
      next.job?.status === "failed"
        ? next.job.error
        : next.syncError
          ? `Your draft is saved, but Navidrome could not be updated: ${next.syncError}`
          : "",
    );
    if (!previous && !initial?.id && next.definition.id)
      createdRef.current?.(next.definition.id);
    if (next.synced) setNotice("Updated in Navidrome.");
    if (
      previous &&
      (next.revision !== previous.revision ||
        (activeJob(previous) && !activeJob(next)))
    )
      changedRef.current();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const id = definition?.id;
    let active = true,
      inFlight = false;
    const key = id
      ? `curator-chat-pending:${ownerUserId}:${id}`
      : `curator-chat-new:${ownerUserId}`;
    const refresh = async () => {
      if (
        !active ||
        inFlight ||
        sending.current ||
        document.visibilityState !== "visible"
      )
        return;
      inFlight = true;
      try {
        if (!id) {
          const pending = cachedSubmission(key);
          if (!pending) return;
          const created = await readJson<State>(
            await fetch("/api/playlists/chat", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(pending),
              keepalive: true,
            }),
          );
          cacheSubmission(key, null);
          if (active) {
            apply(created);
            setMessage("");
            changedRef.current();
          }
          return;
        }
        let next = await readJson<State>(
          await fetch(`/api/playlists/${id}/chat`, { cache: "no-store" }),
          "Conversation could not be loaded",
        );
        if (!active) return;
        const pending = cachedSubmission(key);
        if (pending) {
          if (next.job?.id === pending.requestId) {
            cacheSubmission(key, null);
            setMessage("");
          } else if (next.revision === pending.revision && !activeJob(next)) {
            next = await readJson<State>(
              await fetch(`/api/playlists/${id}/chat`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(pending),
                keepalive: true,
              }),
            );
            cacheSubmission(key, null);
            if (active) setMessage("");
          } else if (next.revision !== pending.revision) {
            cacheSubmission(key, null);
            setMessage((current) => current || pending.message);
          }
        }
        if (active) apply(next);
      } catch (error) {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Connection interrupted. We will reconnect when this page is active.",
          );
      } finally {
        inFlight = false;
        if (active) setBusy((current) => (current === "load" ? "" : current));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [definition?.id, ownerUserId, apply]);
  useEffect(() => {
    const key = `curator-chat-draft:${ownerUserId}:${definition?.id ?? "new"}`;
    try {
      const draft = JSON.parse(localStorage.getItem(key) ?? "null");
      if (draft) {
        setMessage(draft.message ?? "");
        setTargetTracks(draft.targetTracks ?? 20);
      }
    } catch {}
  }, [ownerUserId, definition?.id]);
  function changeDraft(next: string, count = targetTracks) {
    setMessage(next);
    try {
      localStorage.setItem(
        `curator-chat-draft:${ownerUserId}:${definition?.id ?? "new"}`,
        JSON.stringify({ message: next, targetTracks: count }),
      );
    } catch {}
  }
  async function submitMessage(text: string, count: number) {
    if (!text.trim() || busy || working || sending.current) return;
    sending.current = true;
    setBusy("submit");
    setError("");
    setNotice("");
    try {
      const key = definition?.id
        ? `curator-chat-pending:${ownerUserId}:${definition.id}`
        : `curator-chat-new:${ownerUserId}`;
      const pending = cachedSubmission(key) ?? {
        requestId: crypto.randomUUID(),
        message: text.trim(),
        targetTracks: count,
        revision: stateRef.current?.revision ?? 0,
      };
      cacheSubmission(key, pending);
      const path = definition?.id
        ? `/api/playlists/${definition.id}/chat`
        : "/api/playlists/chat";
      const result = await readJson<State>(
        await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending),
          keepalive: true,
        }),
        "Your message could not be submitted",
      );
      cacheSubmission(key, null);
      try {
        localStorage.removeItem(
          `curator-chat-draft:${ownerUserId}:${definition?.id ?? "new"}`,
        );
      } catch {}
      if (mounted.current) {
        apply(result);
        setMessage("");
      }
      changedRef.current();
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    await submitMessage(message, targetTracks);
  }

  async function sync() {
    if (!definition?.id || busy || working) return;
    sending.current = true;
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      await readJson(
        await fetch(`/api/playlists/${definition.id}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preview: false }),
        }),
      );
      const updated = await readJson<State>(
        await fetch(`/api/playlists/${definition.id}/chat`, {
          cache: "no-store",
        }),
      );
      apply(updated);
      setNotice(
        "Saved to Navidrome. Future chat corrections will update it there too.",
      );
      changed();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy("");
    }
  }

  const items = state?.result?.items ?? [];
  const params = useSearchParams();
  const linked = !!definition?.navidromePlaylistId;
  const title = definition?.name?.startsWith("Chat playlist ")
    ? "New playlist"
    : (definition?.name ?? "Create a playlist in chat");
  return (
    <div className="playlist-chat-page">
      <BackLink href={definition?.id ? "/playlists" : "/playlists/new"}>
        {definition?.id ? "Playlists" : "Playlist types"}
      </BackLink>
      <PageHeader
        title={title}
        description={
          working
            ? "Creating mix · you can leave"
            : state?.syncError
              ? `Draft saved · Navidrome update failed`
              : linked
                ? `Saved to Navidrome · ${items.length} songs`
                : items.length
                  ? `Draft · ${items.length} songs`
                  : "Tell Curator what you’d like to hear."
        }
      />
      {params.get("native") === "unavailable" && (
        <Notice>
          The playlist could not be found in Navidrome.{" "}
          <a href="/api/navidrome/open" target="_blank" rel="noreferrer">
            Open Navidrome
          </a>
        </Notice>
      )}
      {working && (
        <div className="notice-panel" role="status">
          <LoaderCircle className="spin" />
          <span>
            {state?.job?.status === "queued"
              ? "Your message is queued."
              : "Exploring your library and shaping the mix."}{" "}
            You can leave this page; the reply will be here when you return.
          </span>
        </div>
      )}
      <nav className="view-tabs chat-tabs" aria-label="Playlist view">
        <button
          className={tab === "conversation" ? "selected" : ""}
          aria-pressed={tab === "conversation"}
          onClick={() => setTab("conversation")}
        >
          Conversation
        </button>
        <button
          className={tab === "mix" ? "selected" : ""}
          aria-pressed={tab === "mix"}
          onClick={() => setTab("mix")}
        >
          Mix{items.length ? ` · ${items.length}` : ""}
        </button>
      </nav>
      <div className="playlist-chat-content" data-tab={tab}>
        <section
          className="playlist-chat-conversation"
          aria-label="Conversation"
        >
          <div
            className="playlist-chat-log"
            role="log"
            aria-live="polite"
            aria-label="Playlist conversation"
            ref={log}
          >
            {!state?.messages.length && !state?.job && (
              <div className="playlist-chat-welcome">
                <strong>Curator</strong>
                <p>
                  What should the playlist feel like? Describe a mood, an
                  occasion, or artists you like.
                </p>
              </div>
            )}
            {state?.messages.map((item, index) => (
              <article
                className={`playlist-chat-message ${item.role}`}
                key={index}
              >
                <strong>{item.role === "user" ? "You" : "Curator"}</strong>
                <p>{item.content}</p>
              </article>
            ))}
            {state?.job && state.job.resultRevision === null && (
              <article className="playlist-chat-message user">
                <strong>You</strong>
                <p>{state.job.message}</p>
              </article>
            )}
            {busy === "load" && <p role="status">Loading your conversation…</p>}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {state?.job?.status === "failed" && (
            <button
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() =>
                void submitMessage(state.job!.message, state.job!.targetTracks)
              }
            >
              Retry message
            </button>
          )}
          {notice && (
            <p className="form-notice" role="status">
              {notice}
            </p>
          )}
          <form className="playlist-chat-composer" onSubmit={send}>
            <label className="chat-count" htmlFor="playlist-chat-count">
              Songs{" "}
              <input
                id="playlist-chat-count"
                type="number"
                min={1}
                max={100}
                value={targetTracks}
                disabled={Boolean(busy) || working}
                onChange={(event) => {
                  const count = Number(event.target.value);
                  setTargetTracks(count);
                  changeDraft(message, count);
                }}
                required
              />
            </label>
            <label className="sr-only" htmlFor="playlist-chat-message">
              {items.length ? "Ask for a change" : "Describe your playlist"}
            </label>
            <textarea
              id="playlist-chat-message"
              ref={input}
              value={message}
              maxLength={3000}
              rows={3}
              disabled={Boolean(busy) || working}
              onChange={(event) => changeDraft(event.target.value)}
              placeholder={
                items.length
                  ? "A little less guitar, and keep the opening gentle…"
                  : "A late-night mix, warm and a little unusual…"
              }
              required
            />
            <div className="composer-footer">
              <small>
                {linked
                  ? "Changes update this playlist in Navidrome."
                  : "Changes stay in your draft until you save."}
              </small>
              <button
                className="primary-button"
                disabled={
                  Boolean(busy) ||
                  working ||
                  !message.trim() ||
                  targetTracks < 1 ||
                  targetTracks > 100
                }
              >
                {busy === "submit"
                  ? "Sending…"
                  : working
                    ? "Working…"
                    : items.length
                      ? "Send"
                      : "Create mix"}
                <Send />
              </button>
            </div>
          </form>
        </section>
        <section className="playlist-chat-songs" aria-label="Selected songs">
          <div className="section-heading">
            <h2>Your mix</h2>
            <small className="muted">
              {items.length ? `${items.length} songs` : "No songs yet"}
            </small>
          </div>
          {!items.length ? (
            <div className="empty-state">
              <p>Your songs will appear here after your first message.</p>
            </div>
          ) : (
            <div className="song-list">
              {items.map((item, index) => (
                <article className="song-row" key={item.fileId}>
                  <span className="song-number">{index + 1}</span>
                  <Artwork
                    src={`/api/library/artwork?fileId=${item.fileId}&kind=album`}
                  />
                  <div>
                    <Link
                      className="song-title"
                      href={entityHref("songs", item.fileId)}
                    >
                      {item.title}
                    </Link>
                    <div className="song-context">
                      <Link href={entityHref("artists", item.artist)}>
                        {item.artist}
                      </Link>{" "}
                      · {item.album}
                    </div>
                    <details className="song-reason">
                      <summary>Why this song?</summary>
                      <p>{item.reason}</p>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          )}
          {state?.result && state.result.detail.pending > 0 && (
            <p className="muted small">
              {state.result.detail.pending} more songs needed. Broaden your
              request or reduce the count before saving.
            </p>
          )}
          <footer className="playlist-save">
            {linked && !state?.syncError ? (
              <a
                className="primary-button"
                href={nativePlaylistHref(definition!.id!)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Navidrome
                <ExternalLink />
              </a>
            ) : (
              <button
                className="primary-button"
                disabled={
                  Boolean(busy) ||
                  working ||
                  !items.length ||
                  Boolean(state?.result?.detail.pending) ||
                  definition?.ownerTokenStatus !== "active"
                }
                onClick={() => void sync()}
              >
                {busy === "sync"
                  ? "Saving…"
                  : state?.syncError
                    ? "Retry Navidrome update"
                    : "Save to Navidrome"}
                <ExternalLink />
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
