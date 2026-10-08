"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Compass,
  Disc3,
  ExternalLink,
  History,
  Library,
  LoaderCircle,
  Music2,
  PlusCircle,
  Route,
  Sparkles,
} from "lucide-react";
import { readJson } from "./http";

type User = { id: number; displayName: string; tokenStatus: string };
type Track = { file_id: number; title: string; artist: string; album: string; reason: string; retained: number };
type Mix = { id: number; name: string; navidrome_playlist_id: string | null; tracks: Track[] } | null;
type Data = {
  user: User;
  users: User[];
  playlistCount: number;
  tonight: Mix;
  rediscover: Mix;
  discovery: Mix;
  depth: Mix;
  fresh: Array<{ fileId: number; artist: string; album: string; updatedAt: string }>;
  requests: Array<{ id: number; artist: string; album: string; status: string; updatedAt: string }>;
  libraryTracks: number;
  navidromePublicUrl: string;
};

const playlistLink = (userId: number) => `/playlists?userId=${userId}`;

function TrackList({ tracks }: { tracks: Track[] }) {
  return <div className="home-track-list">{tracks.slice(0, 5).map((track, index) => <article key={track.file_id}><span>{index + 1}</span><div><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></div><em>{track.retained ? "Kept in rotation" : track.reason}</em></article>)}</div>;
}

function MixCard({ title, eyebrow, mix, icon: Icon, userId }: { title: string; eyebrow: string; mix: Mix; icon: typeof History; userId: number }) {
  if (!mix?.tracks.length) return null;
  return <article className="home-module"><header><div className="home-module-icon"><Icon /></div><div><span className="kicker">{eyebrow}</span><h3>{title}</h3><p>{mix.name}</p></div></header><TrackList tracks={mix.tracks} /><Link href={playlistLink(userId)}>Tune this mix <ArrowRight /></Link></article>;
}

export function PersonalizedHome() {
  const [data, setData] = useState<Data | null>(null);
  const [target, setTarget] = useState<number>();
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = useCallback(async (id?: number) => {
    const requestId = ++request.current;
    setError("");
    try {
      const response = await fetch(`/api/home${id ? `?userId=${id}` : ""}`, { cache: "no-store" });
      const body = await readJson<Data>(response, "Home is unavailable");
      if (requestId !== request.current) return;
      setData(body);
      setTarget(body.user.id);
    } catch (reason) {
      if (requestId !== request.current) return;
      setError(reason instanceof Error ? reason.message : "Home is unavailable");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error && !data) return <div className="empty-state"><Disc3 /><h3>Home could not be prepared</h3><p>{error}</p><button className="primary-button" onClick={() => void load(target)}>Retry</button></div>;
  if (!data) return <div className="playlist-loading"><LoaderCircle className="spin" />Preparing your music…</div>;

  const open = `${data.navidromePublicUrl.replace(/\/$/, "")}/app/#/playlist`;
  const playlists = playlistLink(data.user.id);
  return <div className="personal-home">
    <header className="home-heading"><div><span className="kicker">Personalized listening</span><h2>Good evening, {data.user.displayName}</h2><p>Familiar favorites, fresh arrivals, and a little room for surprise.</p></div></header>
    {error && <div className="playlist-notice" role="status"><span>{error}</span><button onClick={() => void load(data.user.id)}>Retry</button></div>}
    {data.tonight?.tracks.length ? <section className="tonight-card"><div><span className="kicker"><Sparkles />Tonight for {data.user.displayName}</span><h2>{data.tonight.name}</h2><p>{data.tonight.tracks.length} considered tracks, shaped by this listener’s library signals.</p><div className="home-actions"><a className="primary-button" href={open} target="_blank" rel="noreferrer"><ExternalLink />Open in Navidrome</a><Link className="secondary-button" href={playlists}>Adjust mix</Link></div></div><TrackList tracks={data.tonight.tracks} /></section> : <section className="home-empty-hero"><Sparkles /><div><h2>{data.playlistCount ? "Your playlists are ready to shape" : "What would you like to hear?"}</h2><p>{data.playlistCount ? "Preview and publish a mix, or return to a playlist chat. You choose which playlists refresh nightly." : "Describe a mix in chat, choose a playlist type, or start from a suggestion based on your listening."}</p><Link className="primary-button" href={playlists}>Your playlists <ArrowRight /></Link></div></section>}
    <section className="home-module-grid"><MixCard title="Bring an old favorite back" eyebrow="Rediscover" mix={data.rediscover} icon={History} userId={data.user.id} /><MixCard title="Something beyond the usual" eyebrow="New for you" mix={data.discovery} icon={Compass} userId={data.user.id} /><MixCard title="Go deeper in your collection" eyebrow="Because you listened" mix={data.depth} icon={Library} userId={data.user.id} /></section>
    {data.fresh.length > 0 && <section className="fresh-section"><header><div><span className="kicker">Freshly curated</span><h2>New in the archive</h2></div><Link href="/library">Browse library <ArrowRight /></Link></header><div className="fresh-grid">{data.fresh.map((item) => <button key={item.fileId} onClick={() => { location.href = "/library"; }}><span><Disc3 /></span><strong>{item.album}</strong><small>{item.artist}</small></button>)}</div></section>}
    <section className="home-bottom-grid"><article className="request-card"><header><div><span className="kicker">Your requests</span><h3>On the way</h3></div><Link href="/add"><PlusCircle />Add music</Link></header>{data.requests.length ? <div>{data.requests.map((item) => <p key={item.id}><span><strong>{item.album}</strong><small>{item.artist}</small></span><em><Clock3 />{item.status}</em></p>)}</div> : <div className="compact-empty"><Music2 /><span>This listener’s album requests and status will appear here.</span></div>}</article><article className="shortcut-card"><span className="kicker">Shape the next session</span><h3>Choose a direction</h3><div><Link href={playlists}><Sparkles />Mood or occasion</Link><Link href={playlists}><Compass />Discovery lane</Link><Link href={playlists}><Route />Progressive journey</Link></div></article></section>
  </div>;
}
