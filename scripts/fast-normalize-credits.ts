import { copyFile, chmod, open, rename, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db, stateGet, stateSet } from "../src/features/db/client";
import { splitArtistCredits, splitComposerCredits } from "../src/features/scanner/credits";

const run = promisify(execFile);
const environment = { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
type FileRow = { id:number; path:string; inode:number; size:number; mtime_ms:number; status:string; tags_json:string };

function values(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean);
}

function present(value: unknown): boolean {
  return Array.isArray(value) ? value.some(present) : typeof value === "string" ? Boolean(value.trim()) : value != null;
}

function alias(name: string): string {
  return name.toLowerCase() === "billie joe" ? "Billie Joe Armstrong" : name;
}

function needsNormalization(tags: Record<string,unknown>): boolean {
  const rawComposer = values(tags.composer ?? tags.COMPOSER);
  const normalized = splitComposerCredits([...rawComposer, ...values(tags.AUTHOR)]).map(alias);
  const rawArtist = values(tags.artist);
  return present(tags.AUTHOR) || present(tags.AUTHORS) || present(tags.COMPOSERS) ||
    rawArtist.some(value => /(?:feat\.|ft\.)/i.test(value)) ||
    normalized.length !== rawComposer.length || normalized.some((value,index) => value !== rawComposer[index]?.trim());
}

function desired(tags: Record<string,unknown>): Record<string,string[]> {
  const artists = splitArtistCredits([...values(tags.artists), ...values(tags.artist), ...values(tags.ARTISTS)]);
  const albumArtists = splitArtistCredits([...values(tags.albumArtists), ...values(tags.albumArtist), ...values(tags.ALBUMARTISTS)]);
  const composers = splitComposerCredits([...values(tags.composer ?? tags.COMPOSER), ...values(tags.AUTHOR)]).map(alias);
  return {
    ARTIST: [artists.join(" feat. ")].filter(Boolean), ARTISTS: artists,
    ALBUMARTISTS: albumArtists, COMPOSER: composers,
    COMPOSERS: [], AUTHOR: [], AUTHORS: [],
  };
}

async function rewrite(file: FileRow, tags: Record<string,unknown>): Promise<void> {
  const current = await stat(file.path);
  if (Number(current.ino) !== file.inode || current.size !== file.size || current.mtimeMs !== file.mtime_ms) throw new Error(`Changed after scan: ${file.path}`);
  const temp = `${file.path}.curator-fast-${process.pid}`;
  const properties = desired(tags), args: string[] = [];
  for (const [key,list] of Object.entries(properties)) {
    args.push(`--remove-tag=${key}`);
    for (const value of list) args.push(`--set-tag=${key}=${value}`);
  }
  try {
    await copyFile(file.path,temp); await chmod(temp,current.mode);
    await run("metaflac",[...args,temp],{env:environment,timeout:10*60_000,maxBuffer:4*1024*1024});
    const handle=await open(temp,"r+"); await handle.sync(); await handle.close(); await rename(temp,file.path);
    const updated=await stat(file.path);
    tags.artist=properties.ARTIST; tags.artists=properties.ARTISTS; tags.albumArtists=properties.ALBUMARTISTS; tags.composer=properties.COMPOSER;
    delete tags.AUTHOR; delete tags.AUTHORS; delete tags.COMPOSERS;
    const semanticGap=["genre","style","mood","scene","albumArtist"].some(field=>!present(tags[field]));
    db().prepare("UPDATE files SET inode=?,size=?,mtime_ms=?,tags_json=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(updated.ino),updated.size,updated.mtimeMs,JSON.stringify(tags),semanticGap?"analyzed":"written",file.id);
  } finally { await rm(temp,{force:true}); }
}

async function main(): Promise<void> {
  if (stateGet("paused")!=="true" || stateGet("scheduler_running")==="true" || stateGet("credit_artwork_running")==="true") throw new Error("Pause Curator and wait for all writers to become idle first");
  if (stateGet("fast_normalizer_running")==="true") throw new Error("Fast normalizer is already running");
  stateSet("fast_normalizer_running","true");
  let checked=0,written=0,failed=0;
  try {
    const files=db().prepare("SELECT id,path,inode,size,mtime_ms,status,tags_json FROM files WHERE lower(path) LIKE '%.flac'").all() as FileRow[];
    for (const file of files) {
      checked++; let tags:Record<string,unknown>={}; try{tags=JSON.parse(file.tags_json)}catch{failed++;continue}
      if(!needsNormalization(tags))continue;
      try{await rewrite(file,tags);written++}catch(error){failed++;console.error(String(error))}
      if(written%25===0)console.log(JSON.stringify({checked,written,failed}));
    }
    stateSet("fast_normalizer_result",JSON.stringify({checked,written,failed,finishedAt:new Date().toISOString()}));
    console.log(JSON.stringify({checked,written,failed}));
  } finally { stateSet("fast_normalizer_running","false"); }
}

void main().catch(error=>{console.error(error);process.exitCode=1});
