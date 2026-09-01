"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, Disc3, ImageOff, ListMusic,
  Mic2, MoreHorizontal, Music2, Search, Tags, UsersRound, X,
} from "lucide-react";
import { LibraryEntityDrawer } from "@/components/library-entity-drawer";

const views = [
  { key: "albums", label: "Albums", icon: Disc3, primary: true },
  { key: "artists", label: "Artists", icon: Mic2, primary: true },
  { key: "songs", label: "Songs", icon: Music2, primary: true },
  { key: "composers", label: "Composers", icon: UsersRound },
  { key: "years", label: "Years", icon: CalendarDays },
  { key: "labels", label: "Labels", icon: Tags },
];
type Item = { key:string; title:string; subtitle:string; count:number; year:string; status:string; artwork:string };
type Result = { items:Item[]; total:number; page:number; pageSize:number; message?:string };
type Selection = { view:string; key:string };
const globalViews = ["artists", "albums", "songs"] as const;

export function LibraryBrowser() {
  const [view,setView] = useState("albums"), [query,setQuery] = useState(""), [search,setSearch] = useState("");
  const [page,setPage] = useState(1), [result,setResult] = useState<Result|null>(null);
  const [global,setGlobal] = useState<Record<string,Result>|null>(null), [loading,setLoading] = useState(true);
  const [error,setError] = useState(""), [selected,setSelected] = useState<Selection|null>(null);
  const request = useCallback(async(nextView:string,nextSearch:string,nextPage=1) => {
    const params = new URLSearchParams({view:nextView,q:nextSearch,page:String(nextPage),limit:"30"});
    const response = await fetch(`/api/library/browse?${params}`,{cache:"no-store"});
    const body = await response.json();
    if(!response.ok) throw new Error(body.error || "Library unavailable");
    return body as Result;
  },[]);
  const load = useCallback(async() => {
    setLoading(true); setError("");
    try {
      if(search) {
        const values = await Promise.all(globalViews.map(item => request(item,search,1)));
        setGlobal(Object.fromEntries(globalViews.map((item,index) => [item,values[index]]))); setResult(null);
      } else { setResult(await request(view,"",page)); setGlobal(null); }
    } catch(reason) { setError(String(reason)); } finally { setLoading(false); }
  },[page,request,search,view]);
  useEffect(() => { void load(); },[load]);
  useEffect(() => { const timer=setTimeout(() => { setPage(1); setSearch(query.trim()); },280); return () => clearTimeout(timer); },[query]);
  const total = useMemo(() => global ? Object.values(global).reduce((sum,item) => sum+item.total,0) : result?.total ?? 0,[global,result]);
  const label = views.find(item => item.key===view)?.label ?? "Library";
  function switchView(next:string) { setView(next); setPage(1); setSelected(null); setQuery(""); setSearch(""); }
  function submit(event:FormEvent) { event.preventDefault(); setPage(1); setSearch(query.trim()); }
  function clearSearch() { setQuery(""); setSearch(""); setPage(1); }
  function cards(items:Item[],itemView:string) {
    return <div className={`media-grid ${itemView==="songs"?"song-grid":""}`}>
      {items.map(item => <button className="media-card" key={`${itemView}:${item.key}`} onClick={() => setSelected({view:itemView,key:item.key})} aria-label={`Open ${item.title}`}>
        <div className="media-art"><ImageOff aria-hidden="true"/><img src={item.artwork} alt="" loading="lazy" onError={event => { event.currentTarget.style.display="none"; }}/><span className={`media-state ${item.status}`} title={item.status}/></div>
        <div className="media-copy"><strong title={item.title}>{item.title}</strong><span>{item.subtitle}</span>{item.year&&<small>{item.year}</small>}</div>
      </button>)}
    </div>;
  }
  return <div className="library-workspace">
    <header className="library-commandbar">
      <div><span className="kicker">Your collection</span><h2>{search?"Search results":label}</h2><p>{loading?"Updating library":`${total.toLocaleString()} ${search?"matches":"items"}`}</p></div>
      <form className="library-search" role="search" onSubmit={submit}><Search aria-hidden="true"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search your library" aria-label="Search artists, albums and songs"/>{query&&<button type="button" onClick={clearSearch} aria-label="Clear search"><X/></button>}</form>
    </header>
    <nav className="library-viewbar" aria-label="Library views">
      {views.filter(item=>item.primary).map(({key,label:option,icon:Icon}) => <button key={key} className={view===key&&!search?"active":""} onClick={()=>switchView(key)} aria-current={view===key&&!search?"page":undefined}><Icon/><span>{option}</span></button>)}
      <details className="library-more"><summary className={!views.find(item=>item.key===view)?.primary&&!search?"active":""}><MoreHorizontal/><span>More</span></summary><div>{views.filter(item=>!item.primary).map(({key,label:option,icon:Icon})=><button key={key} onClick={()=>switchView(key)}><Icon/><span>{option}</span></button>)}</div></details>
    </nav>
    {error&&<div className="inline-error">{error}</div>}
    {loading?<div className="media-grid skeleton-grid">{Array.from({length:15},(_,index)=><div className="media-card skeleton" key={index}/>)}</div>
      :global?<div className="global-results">{globalViews.map(itemView=>{const group=global[itemView];return <section key={itemView}><div className="result-heading"><h3>{views.find(item=>item.key===itemView)?.label}</h3><span>{group.total.toLocaleString()}</span></div>{group.items.length?cards(group.items.slice(0,10),itemView):<p className="quiet-empty">No matching {itemView}</p>}</section>})}</div>
      :result?.message?<div className="empty-state"><ListMusic/><h3>Playlists are unavailable</h3><p>{result.message}</p></div>
      :result&&cards(result.items,view)}
    {!search&&result&&result.total>result.pageSize&&<div className="pagination"><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft/>Previous</button><span>{page} / {Math.ceil(result.total/result.pageSize)}</span><button disabled={page>=Math.ceil(result.total/result.pageSize)} onClick={()=>setPage(value=>value+1)}>Next<ChevronRight/></button></div>}
    {selected&&<LibraryEntityDrawer view={selected.view} entityKey={selected.key} onClose={()=>setSelected(null)} onSaved={load}/>} 
  </div>;
}
