"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Clock3, Plus } from "lucide-react";
import { BackLink, Loading, Notice, PageHeader, entityHref } from "./ui";
import { readJson } from "./http";
export type MusicRequest = {
  id: number;
  artist: string;
  album: string;
  foreignAlbumId: string;
  status: string;
  detail: string;
  albumKey: string | null;
  updatedAt: string;
};
export const requestLabels: Record<string, string> = {
  added: "Added",
  preparing: "Preparing",
  downloading: "Downloading",
  attention: "Needs attention",
  waiting: "Waiting",
  searching: "Searching",
};
export function MusicRequests({ id }: { id?: number }) {
  const [items, setItems] = useState<MusicRequest[]>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/music/requests" + (id ? "?id=" + id : ""),
        { cache: "no-store" },
      );
      const result = await readJson<
        MusicRequest | { requests: MusicRequest[] }
      >(response);
      setItems("requests" in result ? result.requests : [result]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Requests unavailable");
    }
  }, [id]);
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  const item = id ? items?.[0] : null;
  return (
    <>
      <BackLink href={id ? "/requests" : "/library"}>
        {id ? "Your requests" : "Library"}
      </BackLink>
      <PageHeader
        title={id ? "Album request" : "Your requests"}
        actions={
          !id ? (
            <Link className="secondary-button" href="/add">
              <Plus />
              Add music
            </Link>
          ) : undefined
        }
      />
      {error ? (
        <Notice error>
          {error}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </Notice>
      ) : !items ? (
        <Loading>Loading requests…</Loading>
      ) : item ? (
        <>
          <div className="request-identity">
            <h2>{item.album}</h2>
            <p className="muted">{item.artist}</p>
          </div>
          <Notice>
            <span className="request-state">
              {item.status === "added" ? <Check /> : <Clock3 />}
              {requestLabels[item.status]}
            </span>
            {item.detail}
          </Notice>
          {item.albumKey && (
            <Link
              className="primary-button"
              href={entityHref("albums", item.albumKey)}
            >
              Open album
              <ArrowRight />
            </Link>
          )}
          {item.status === "attention" && (
            <Link className="secondary-button" href="/curator/diagnostics">
              View library care
              <ArrowRight />
            </Link>
          )}
          <p className="muted small section">
            This request belongs to your account. Albums are added to the shared
            music library.
          </p>
        </>
      ) : items.length ? (
        items.map((r) => (
          <Link className="request-row" key={r.id} href={"/requests/" + r.id}>
            <div>
              <strong>{r.album}</strong>
              <span>{r.artist}</span>
            </div>
            <span className="playlist-state">{requestLabels[r.status]}</span>
            <ArrowRight />
          </Link>
        ))
      ) : (
        <div className="empty-state">
          <h2>No requests yet</h2>
          <p>Find an album you’d like to add to your library.</p>
          <Link className="primary-button" href="/add">
            Find an album
          </Link>
        </div>
      )}
    </>
  );
}
