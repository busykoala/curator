"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Plus } from "lucide-react";
import {
  Artwork,
  Loading,
  Notice,
  PageHeader,
  entityHref,
  nativePlaylistHref,
} from "./ui";
import { readJson } from "./http";
import { getMeta, type PlaylistDefinition } from "./playlist-view-model";
import { requestLabels, type MusicRequest } from "./music-requests";
import { playlistStatus } from "./playlist-status";
type Data = {
  continueMixes: Array<PlaylistDefinition & { artworkFileId: number | null }>;
  fresh: Array<{
    fileId: number;
    albumKey: string;
    artist: string;
    album: string;
  }>;
  requests: MusicRequest[];
};
export function PersonalizedHome() {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(
        await readJson<Data>(await fetch("/api/home", { cache: "no-store" })),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Home unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  return (
    <>
      <PageHeader title="Home" />
      {error && (
        <Notice error>
          {error}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </Notice>
      )}
      {!data ? (
        <Loading>Loading your music…</Loading>
      ) : (
        <>
          <section>
            <div className="section-heading">
              <h2>
                {data.continueMixes.length
                  ? "Pick up where you left off"
                  : "What would you like to hear?"}
              </h2>
              <Link className="text-link" href="/playlists/new">
                New playlist
                <Plus />
              </Link>
            </div>
            {data.continueMixes.length ? (
              <div className="home-continue-list">
                {data.continueMixes.map((item) => {
                  const active =
                      item.chatJob?.status === "running" ||
                      item.chatJob?.status === "queued",
                    ready =
                      !!item.navidromePlaylistId &&
                      !active &&
                      !item.unreadReply &&
                      !item.chatJob?.syncError;
                  return (
                    <article className="continue-card" key={item.id}>
                      <Artwork
                        src={
                          item.artworkFileId
                            ? `/api/library/artwork?fileId=${item.artworkFileId}&kind=album`
                            : undefined
                        }
                      />
                      <div>
                        <span
                          className={
                            "playlist-state " +
                            (item.unreadReply ? "reply-ready" : "")
                          }
                        >
                          {playlistStatus(item)}
                        </span>
                        <h3>
                          <Link href={"/playlists/" + item.id}>
                            {item.category === "chat" &&
                            item.name.startsWith("Chat playlist ")
                              ? "New playlist"
                              : item.name}
                          </Link>
                        </h3>
                        <p>
                          {getMeta(item.category).label} ·{" "}
                          {Number(item.config.targetTracks)} songs
                        </p>
                        <div className="button-row">
                          {ready ? (
                            <a
                              className="primary-button"
                              href={nativePlaylistHref(item.id!)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Navidrome
                              <ExternalLink />
                            </a>
                          ) : (
                            <Link
                              className="primary-button"
                              href={"/playlists/" + item.id}
                            >
                              {item.unreadReply
                                ? "Read reply"
                                : active
                                  ? "Open chat"
                                  : "Review mix"}
                            </Link>
                          )}
                          {ready && (
                            <Link
                              className="text-link"
                              href={"/playlists/" + item.id}
                            >
                              {item.category === "chat"
                                ? "Continue chat"
                                : "View mix"}
                            </Link>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state home-empty">
                <p>
                  Describe a mix in chat or choose a playlist type to explore
                  your collection.
                </p>
                <Link className="primary-button" href="/playlists/new/chat">
                  Create a playlist in chat
                  <ArrowRight />
                </Link>
              </div>
            )}
          </section>
          {data.fresh.length > 0 && (
            <section className="section">
              <div className="section-heading">
                <h2>Recently updated</h2>
                <Link className="text-link" href="/library?sort=recent">
                  View all
                  <ArrowRight />
                </Link>
              </div>
              <div className="media-grid home-album-grid">
                {data.fresh.map((a) => (
                  <Link
                    className="media-card"
                    key={a.albumKey}
                    href={entityHref("albums", a.albumKey)}
                  >
                    <Artwork
                      src={`/api/library/artwork?fileId=${a.fileId}&kind=album`}
                    />
                    <span className="media-copy">
                      <strong>{a.album}</strong>
                      <span>{a.artist}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {data.requests.length > 0 && (
            <section className="section">
              <div className="section-heading">
                <h2>On the way</h2>
                <Link className="text-link" href="/requests">
                  View requests
                  <ArrowRight />
                </Link>
              </div>
              {data.requests.map((item) => (
                <Link
                  className="request-row"
                  key={item.id}
                  href={"/requests/" + item.id}
                >
                  <div>
                    <strong>{item.album}</strong>
                    <span>{item.artist}</span>
                  </div>
                  <span className="playlist-state">
                    {requestLabels[item.status] ?? item.status}
                  </span>
                  <ArrowRight />
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
