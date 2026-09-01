import { db } from "@/features/db/client";

type Purpose="categorize"|"write";
function ensure():void{db().exec("CREATE TABLE IF NOT EXISTS album_work_leases(album_key TEXT PRIMARY KEY,purpose TEXT NOT NULL,expires_at INTEGER NOT NULL)")}

export function acquireAlbumLease(albumKey:string,purpose:Purpose,ttlMs=6*60*60_000):boolean{
  ensure();
  return db().transaction(()=>{
    db().prepare("DELETE FROM album_work_leases WHERE expires_at<=?").run(Date.now());
    return db().prepare("INSERT OR IGNORE INTO album_work_leases(album_key,purpose,expires_at) VALUES (?,?,?)").run(albumKey,purpose,Date.now()+ttlMs).changes===1;
  })();
}

export function releaseAlbumLease(albumKey:string,purpose:Purpose):void{
  ensure();db().prepare("DELETE FROM album_work_leases WHERE album_key=? AND purpose=?").run(albumKey,purpose);
}

export function clearAlbumLeases():void{ensure();db().prepare("DELETE FROM album_work_leases").run()}
