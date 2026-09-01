import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname,relative } from "node:path";
import { config } from "@/config";
import { db } from "@/features/db/client";
import { centralArtistPath } from "@/features/artwork/manager";
type Row={album_key:string;artist_name:string;album_name:string;path:string};
export async function auditArtwork():Promise<{coversCopied:number;albumsMissing:number;artistsMissing:number}>{
  const rows=db().prepare("SELECT album_key,artist_name,album_name,path FROM files ORDER BY path").all() as Row[],albums=new Map<string,Row[]>(),artists=new Map<string,Row>();for(const row of rows){(albums.get(row.album_key)??(albums.set(row.album_key,[]),albums.get(row.album_key)!)).push(row);if(!artists.has(row.artist_name))artists.set(row.artist_name,row)}
  db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE code IN ('missing_album_artwork','missing_artist_artwork') AND status='open'").run();let coversCopied=0,albumsMissing=0,artistsMissing=0;
  for(const[key,files]of albums){const dirs=[...new Set(files.map(file=>dirname(file.path)))],candidates=[...dirs.map(dir=>`${dir}/cover.jpg`),...dirs.map(dir=>`${dirname(dir)}/cover.jpg`)],source=candidates.find(existsSync);if(source){for(const dir of dirs){const target=`${dir}/cover.jpg`;if(!existsSync(target)){await copyFile(source,target).catch(()=>{});if(existsSync(target))coversCopied++}}}else{albumsMissing++;db().prepare("INSERT INTO issues(album_key,code,severity,message) VALUES (?,'missing_album_artwork','warning','No verified album cover was found; upload one manually or wait for new source evidence')").run(key)}}
  for(const[artist,row]of artists){const root=`${config.MUSIC_ROOT}/${relative(config.MUSIC_ROOT,row.path).split("/")[0]}`,central=centralArtistPath(artist);if(!existsSync(`${root}/artist.jpg`)&&(!central||!existsSync(central))){artistsMissing++;db().prepare("INSERT INTO issues(album_key,code,severity,message) VALUES (?,'missing_artist_artwork','warning',?)").run(row.album_key,`No verified artist image was found for ${artist}; upload one manually or wait for new source evidence`)}}
  return{coversCopied,albumsMissing,artistsMissing};
}
