"use client";

import { FormEvent, useState } from "react";
import { Check, Disc3, LoaderCircle, Music2, Search, UserRound } from "lucide-react";

type Image = { url?:string; coverType?:string };
type Artist = { artistName?:string; foreignArtistId?:string; disambiguation?:string; id?:number; images?:Image[] };
type Album = { title?:string; foreignAlbumId?:string; releaseDate?:string; remoteCover?:string; images?:Image[]; genres?:string[]; artist?:Artist };
type Results = { artists:Artist[]; albums:Album[] };
const image = (album:Album) => album.remoteCover ?? album.images?.find(item=>item.coverType==="cover")?.url ?? album.images?.[0]?.url ?? "";

export function AddMusic() {
  const [term,setTerm] = useState(""), [results,setResults] = useState<Results|null>(null), [searching,setSearching] = useState(false);
  const [adding,setAdding] = useState(""), [added,setAdded] = useState<Set<string>>(new Set()), [notice,setNotice] = useState("");
  async function search(value=term) {
    const query=value.trim(); if(query.length<2)return;
    setSearching(true); setNotice("");
    try { const response=await fetch(`/api/music/search?q=${encodeURIComponent(query)}`,{cache:"no-store"}),body=await response.json(); if(!response.ok)throw new Error(body.error??"Search failed"); setResults(body); }
    catch(error){setNotice(String(error));} finally{setSearching(false);}
  }
  async function add(album:Album) {
    const albumId=album.foreignAlbumId??"",artistId=album.artist?.foreignArtistId??""; if(!albumId||!artistId)return;
    setAdding(albumId); setNotice("");
    try { const response=await fetch("/api/music/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({foreignArtistId:artistId,albumForeignIds:[albumId]})}),body=await response.json(); if(!response.ok)throw new Error(body.error??"Add failed"); setAdded(current=>new Set(current).add(albumId)); setNotice(`${album.title} was sent to Lidarr.`); }
    catch(error){setNotice(String(error));} finally{setAdding("");}
  }
  function submit(event:FormEvent){event.preventDefault();void search();}
  function artistSearch(name:string){setTerm(name);void search(name);}
  return <div className="add-music-workspace">
    <header className="add-music-header"><span className="kicker">Add to your library</span><h2>Find an album</h2><p>Choose a release and Curator will monitor it and start a Lidarr search.</p></header>
    <form className="music-search-box" role="search" onSubmit={submit}><Search aria-hidden="true"/><input value={term} onChange={event=>setTerm(event.target.value)} placeholder="Artist or album" autoFocus aria-label="Search the Lidarr catalog"/><button className="primary-button" disabled={searching||term.trim().length<2}>{searching?<LoaderCircle className="spin"/>:<Search/>}<span>Search</span></button></form>
    {notice&&<div className="notice-panel" role="status">{notice}</div>}
    {!results&&!searching&&<div className="add-music-empty"><Disc3/><div><strong>Search the Lidarr catalog</strong><span>Results appear here as albums, ready to queue.</span></div></div>}
    {results&&<>
      {results.artists.length>0&&<section className="artist-suggestions" aria-label="Matching artists"><div><span className="kicker">Matching artists</span></div><div className="artist-pills">{results.artists.slice(0,6).map(artist=><button key={artist.foreignArtistId??artist.artistName} onClick={()=>artist.artistName&&artistSearch(artist.artistName)}><UserRound/><span><strong>{artist.artistName}</strong>{artist.disambiguation&&<small>{artist.disambiguation}</small>}</span></button>)}</div></section>}
      <div className="result-heading"><div><span className="kicker">Albums</span><h3>{results.albums.length?`${results.albums.length} releases`:`No albums found`}</h3></div></div>
      <section className="album-search-grid">{results.albums.map(album=>{const id=album.foreignAlbumId??album.title??"",isAdded=added.has(id),cover=image(album),available=Boolean(album.foreignAlbumId&&album.artist?.foreignArtistId);return <article className="album-search-card" key={id}><div className="album-search-art">{cover?<img src={cover} alt="" loading="lazy"/>:<Disc3/>}</div><div className="album-search-copy"><span>{album.artist?.artistName??"Unknown artist"}</span><h3>{album.title}</h3><p>{album.releaseDate?.slice(0,4)||"Year unknown"}{album.genres?.length?` · ${album.genres.slice(0,2).join(" · ")}`:""}</p><button className={isAdded?"secondary-button":"primary-button"} disabled={Boolean(adding)||isAdded||!available} onClick={()=>void add(album)}>{adding===id?<LoaderCircle className="spin"/>:isAdded?<Check/>:<Music2/>}<span>{isAdded?"Queued":available?"Add album":"Unavailable"}</span></button></div></article>})}</section>
      {!results.albums.length&&<div className="empty-state"><Disc3/><h3>No matching albums</h3><p>Try the artist name or remove edition and remaster wording.</p></div>}
    </>}
  </div>;
}
