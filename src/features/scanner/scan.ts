import { opendir, stat } from "node:fs/promises";
import { extname } from "node:path";
import { config } from "@/config";
import { db, stateSet } from "@/features/db/client";
import { analyzeFile } from "@/features/analysis/analyze";
import { albumKey, clean } from "./normalize";
import { repairDeezerCensorship } from "./deezer-censorship";
import { TagWorkerPool } from "./tag-worker-pool";
import { detectDuplicates } from "@/features/analysis/duplicates";
const EXTRA = [
  "MUSICBRAINZ_ARTISTID", "MUSICBRAINZ_ALBUMARTISTID", "MUSICBRAINZ_ALBUMID",
  "MUSICBRAINZ_RELEASEGROUPID", "MUSICBRAINZ_TRACKID", "ISRC", "STYLE", "MOOD",
  "SCENE", "ERA", "ARTISTDESCRIPTION", "ALBUMDESCRIPTION", "RELEASEDATE",
  "ORIGINALDATE", "COMPILATION", "DISCTOTAL", "TRACKTOTAL", "VALENCE", "ENERGY",
  "BPM", "TEMPOFEEL", "GROOVE", "DANCEABILITY", "TEXTURE", "TIMBRE", "PRODUCTION",
  "ACOUSTICELECTRONICCHARACTER", "VOCALPROFILE", "INSTRUMENTATION", "LANGUAGE",
  "LYRICALTHEME", "LISTENINGCONTEXT", "STYLEERA", "MUSICALKEY", "MODE", "METER",
  "DYNAMICCHARACTER", "STRUCTURALCHARACTER", "RECORDINGTYPE", "TRACKDESCRIPTION",
];
type ExistingFile = { id: number; path: string; inode: number; size: number; mtime_ms: number; status:string; tags_json:string; properties_json:string; artwork_json:string };
const pathKey = (value: string) => value.normalize("NFC");
async function* audioFiles(root: string): AsyncGenerator<string> { const dir = await opendir(root); for await (const entry of dir) { if (entry.name.startsWith(".") || entry.name === "@eaDir") continue; const path = `${root}/${entry.name}`; if (entry.isDirectory()) yield* audioFiles(path); else if (entry.isFile() && [".flac", ".mp3"].includes(extname(entry.name).toLowerCase())) yield path; } }
async function processFile(path: string, workers: TagWorkerPool, existing?: ExistingFile): Promise<"new" | "changed" | "unchanged" | "failed"> {
  try {
    const metadata = await stat(path);
    if (existing && existing.status!=="error" && existing.inode === Number(metadata.ino) && existing.size === metadata.size && existing.mtime_ms === metadata.mtimeMs) return "unchanged";
    const { tags, properties, pictures } = await workers.read(path, EXTRA); const tagRecord = repairDeezerCensorship(path, tags as unknown as Record<string, unknown>, config.MUSIC_ROOT);
    const artist = clean(tagRecord.albumArtist) || clean(tagRecord.artist) || "Unknown Artist"; const album = clean(tagRecord.album) || "Unknown Album"; const key = albumKey(artist, album);
    const tagsJson=JSON.stringify(tagRecord),propertiesJson=JSON.stringify(properties),artworkJson=JSON.stringify(pictures);
    const contentUnchanged=existing?.tags_json===tagsJson&&existing.properties_json===propertiesJson&&existing.artwork_json===artworkJson;
    const nextStatus=contentUnchanged&&existing?.status==="written"?"written":"analyzed";
    const result = db().prepare(`INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET album_key=excluded.album_key,artist_name=excluded.artist_name,album_name=excluded.album_name,format=excluded.format,inode=excluded.inode,link_count=excluded.link_count,size=excluded.size,mtime_ms=excluded.mtime_ms,tags_json=excluded.tags_json,properties_json=excluded.properties_json,artwork_json=excluded.artwork_json,status=excluded.status,last_seen_at=CURRENT_TIMESTAMP,updated_at=CASE WHEN files.tags_json=excluded.tags_json AND files.properties_json=excluded.properties_json AND files.artwork_json=excluded.artwork_json THEN files.updated_at ELSE CURRENT_TIMESTAMP END RETURNING id`).get(path, key, artist, album, extname(path).slice(1), Number(metadata.ino), metadata.nlink, metadata.size, metadata.mtimeMs, tagsJson, propertiesJson, artworkJson, nextStatus) as { id: number };
    if(nextStatus!=="written")analyzeFile(result.id, key, tagRecord, pictures); return contentUnchanged ? "unchanged" : existing ? "changed" : "new";
  } catch (error) { const message = `${path}: ${String(error)}`;if(existing)db().prepare("UPDATE files SET status='error',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(existing.id); const found = db().prepare("SELECT 1 FROM issues WHERE code='scan_failed' AND status='open' AND message=?").get(message); if (!found) db().prepare("INSERT INTO issues(file_id,code,severity,message) VALUES (?,'scan_failed','error',?)").run(existing?.id??null,message); return "failed"; }
}
export async function scanLibrary(reportJob?:(value:{subject:string;phase:string;currentFile?:string;processedCount:number;totalCount:number})=>void): Promise<Record<string, number>> { const counts = { new: 0, changed: 0, unchanged: 0, failed: 0, removed: 0 }; db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE code='scan_failed' AND status='open'").run(); let seen=0,currentFile="",totalEstimate=0; const report=()=>{const progress={seen,...counts,updatedAt:new Date().toISOString()};stateSet("scan_progress",JSON.stringify(progress));reportJob?.({subject:"Music library",phase:"scan",currentFile,processedCount:seen,totalCount:Math.max(totalEstimate,seen)})}; const yieldToServer = () => new Promise<void>((resolve) => setImmediate(resolve)); const rows=db().prepare("SELECT id,path,inode,size,mtime_ms,status,tags_json,properties_json,artwork_json FROM files").all() as ExistingFile[],known=new Map(rows.map(file=>[file.path,file])),canonical=new Map<string,ExistingFile>();for(const file of rows)if(!canonical.has(pathKey(file.path)))canonical.set(pathKey(file.path),file);totalEstimate=known.size; const pending = new Set<Promise<void>>(); const workers = new TagWorkerPool(2); try { for await (const path of audioFiles(config.MUSIC_ROOT)) { currentFile=path;const existing=known.get(path)??canonical.get(pathKey(path));if(existing){known.delete(existing.path);canonical.delete(pathKey(existing.path));if(existing.path!==path){db().prepare("UPDATE files SET path=? WHERE id=?").run(path,existing.id);existing.path=path}}const task = processFile(path, workers, existing).then((result) => { counts[result] += 1; seen += 1; if (seen % 25 === 0) report(); }).finally(() => pending.delete(task)); pending.add(task); if (pending.size >= 4) { await Promise.race(pending); await yieldToServer(); } } await Promise.all(pending);const missing=[...known.values()],safeLimit=Math.max(100,Math.floor((seen+missing.length)*.05));if(seen>0&&missing.length<=safeLimit){const remove=db().prepare("DELETE FROM files WHERE id=?");db().transaction(()=>{for(const file of missing){remove.run(file.id);counts.removed++}})();stateSet("scan_stale_warning","")}else if(missing.length)stateSet("scan_stale_warning",JSON.stringify({seen,missing:missing.length,reason:"Deletion guard retained absent rows"})); report(); detectDuplicates(); return counts; } finally { await workers.close(); } }
