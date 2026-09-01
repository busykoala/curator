import { dirname, relative } from "node:path";
import { copyFile } from "node:fs/promises";
import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
import { acquireAlbumLease,releaseAlbumLease } from "@/features/scheduler/album-lease";
import type { EvidenceFact } from "@/features/contracts/types";
import { searchApple } from "@/features/sources/apple";
import { searchReleaseGroupCandidates } from "@/features/sources/musicbrainz";
import { identityIsWritable, resolveIdentity } from "@/features/identity/resolve";
import { enrich } from "@/features/enrichment/engine";
import { canonicalize, seedTaxonomy } from "@/features/taxonomy/service";
import { ensureArtistImage, ensureCover } from "@/features/artwork/manager";
import { writeMetadata } from "@/features/writer/write";
import { rescanFolders } from "@/features/sources/lidarr";
import { getManualOverride } from "@/features/manual/overrides";
import { repairDeezerCensorship } from "@/features/scanner/deezer-censorship";
import { splitArtistCredits,splitComposerCredits } from "@/features/scanner/credits";
import { inferGenreFallback } from "@/features/taxonomy/genre-fallback";
import { semanticTagProperties } from "@/features/categorization/tags";
type Row = { id: number; path: string; album_key: string; artist_name: string; album_name: string; inode: number; size: number; mtime_ms: number; tags_json: string; applied_hash: string | null };
type Progress = { subject: string; phase: string; currentFile?: string; processedCount: number; totalCount: number };
function taxonomySnapshot(): Record<string, string[]> { const output: Record<string, string[]> = {}; const rows = db().prepare("SELECT kind,name FROM taxonomy_terms WHERE active=1 ORDER BY name").all() as Array<{ kind: string; name: string }>; for (const row of rows) (output[row.kind] ??= []).push(row.name); return output; }
function era(date?: string): string[] { const year = Number(date?.slice(0, 4)); return year >= 1900 && year <= 2099 ? [`${Math.floor(year / 10) * 10}s`] : []; }
function replaceFileIssue(fileId:number,key:string,code:string,severity:string,message:string):void{const database=db();database.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND code=? AND status='open'").run(fileId,code);database.prepare("INSERT INTO issues(file_id,album_key,code,severity,message) VALUES (?,?,?,?,?)").run(fileId,key,code,severity,message)}
function transientFailure(error:unknown):boolean{return /(?:\b429\b|\b5\d\d\b|temporar(?:y|ily)|timed?\s*out|timeout|econn|connection error|fetch failed|network)/i.test(String(error))}
function safeDescription(value:string,fallback:string):string{return /#{2,}|\ufffd/.test(value)?fallback:value}
export async function processAlbums(limit=12,report:(progress:Progress)=>void=()=>{}):Promise<{albums:number;written:number}>{
  db().exec("CREATE TABLE IF NOT EXISTS file_metadata_overrides(file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,patch_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  seedTaxonomy();
  const keys=db().prepare("SELECT album_key FROM files WHERE status='analyzed' GROUP BY album_key ORDER BY MAX(CASE WHEN EXISTS (SELECT 1 FROM issues i WHERE i.album_key=files.album_key AND i.status='open' AND i.code='identity_unresolved') THEN 1 ELSE 0 END) DESC,MIN(CASE WHEN json_type(tags_json,'$.genre') IS NULL OR json_type(tags_json,'$.albumArtist') IS NULL THEN 0 ELSE 1 END),MIN(updated_at) LIMIT ?").all(limit) as Array<{album_key:string}>;
  let albums=0,written=0;const changedFolders=new Set<string>();
  for(let albumIndex=0;albumIndex<keys.length;albumIndex++){
    if(stateGet("paused")==="true")break;
    const key=keys[albumIndex].album_key,files=db().prepare("SELECT * FROM files WHERE album_key=? AND status='analyzed'").all(key) as Row[];
    if(!files.length)continue;
    if(!acquireAlbumLease(key,"write"))continue;
    const first=files[0],subject=`${first.artist_name} / ${first.album_name}`;
    report({subject,phase:"resolve",processedCount:albumIndex,totalCount:keys.length});
    db().prepare("UPDATE files SET status='processing',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='analyzed'").run(key);
    stateSet("processing_progress",JSON.stringify({artist:first.artist_name,album:first.album_name,tracks:files.length,updatedAt:new Date().toISOString()}));
    try{
      const[mb,apple]=await Promise.all([searchReleaseGroupCandidates(first.artist_name,first.album_name,key),searchApple(first.artist_name,first.album_name,key).catch(()=>({results:[]}))]);const identity=resolveIdentity(first.artist_name,first.album_name,mb["release-groups"]??[],apple.results??[]),manual=getManualOverride(key),manuallyConfirmed=Boolean(manual?.confirmed);if(manual?.artist_name)identity.artist=manual.artist_name;if(manual?.album_name)identity.album=manual.album_name;if(manual?.release_date)identity.date=manual.release_date;if(manual?.artist_mbid)identity.artistId=manual.artist_mbid;if(manual?.release_group_mbid)identity.releaseGroupId=manual.release_group_mbid;
      const evidence:EvidenceFact[]=[{provider:"existing-tags",sourceId:key,retrievedAt:new Date().toISOString(),value:JSON.parse(first.tags_json)},{provider:"musicbrainz",sourceId:identity.releaseGroupId??"unresolved",retrievedAt:new Date().toISOString(),value:{identity,candidates:(mb["release-groups"]??[]).slice(0,3)}},{provider:"apple",sourceId:String(apple.results?.[0]?.collectionId??"none"),retrievedAt:new Date().toISOString(),value:apple.results?.slice(0,3)??[]},...(manual?[{provider:"manual",sourceId:key,retrievedAt:new Date().toISOString(),value:manual} as EvidenceFact]:[])];
      report({subject,phase:"enrich",processedCount:albumIndex,totalCount:keys.length});
      const result=await enrich(key,identity.artist,identity.album,evidence,taxonomySnapshot()),tagGenres=(source:string)=>{const value=(JSON.parse(source) as Record<string,unknown>).genre;return(Array.isArray(value)?value:value?[value]:[]).map(String).filter(Boolean)},albumGenres=files.flatMap(file=>tagGenres(file.tags_json)),artistGenres=(db().prepare("SELECT tags_json FROM files WHERE artist_name=? AND album_key!=?").all(first.artist_name,key) as Array<{tags_json:string}>).flatMap(row=>tagGenres(row.tags_json)),genreInput=result.genres.length?result.genres:inferGenreFallback(identity.artist,identity.album,albumGenres,artistGenres),genres=canonicalize("genre",genreInput,key),styles=canonicalize("style",result.styles,key),moods=canonicalize("mood",result.moods,key),scenes=canonicalize("scene",result.scenes,key),albumDir=dirname(first.path),artistDir=`${config.MUSIC_ROOT}/${relative(config.MUSIC_ROOT,first.path).split("/")[0]}`,writableIdentity=identityIsWritable(identity)||manuallyConfirmed,coverPath=await ensureCover(key,identity.releaseGroupId,albumDir);
      await ensureArtistImage(key,writableIdentity?identity.artistId:undefined,artistDir);
      if(coverPath)for(const dir of new Set(files.map(file=>dirname(file.path))))if(`${dir}/cover.jpg`!==coverPath)await copyFile(coverPath,`${dir}/cover.jpg`).catch(()=>{});
      let fileFailures=0;
      for(let fileIndex=0;fileIndex<files.length;fileIndex++){
        const file=files[fileIndex],tags=repairDeezerCensorship(file.path,JSON.parse(file.tags_json) as Record<string,unknown>,config.MUSIC_ROOT),scalar=(value:unknown):string=>Array.isArray(value)?String(value[0]??""):String(value??""),trackArtists=splitArtistCredits([tags.artists,tags.artist,tags.ARTISTS].flat()),displayArtist=trackArtists.join(" feat. ")||identity.artist;
        report({subject,phase:"write",currentFile:file.path,processedCount:fileIndex,totalCount:files.length});
        const properties:Record<string,string[]>={TITLE:[scalar(tags.title)].filter(Boolean),ARTIST:[displayArtist],ARTISTS:trackArtists.length?trackArtists:[identity.artist],ALBUM:[identity.album],ALBUMARTIST:[identity.artist],ALBUMARTISTS:[identity.artist],GENRE:genres,STYLE:styles,MOOD:moods,SCENE:scenes,ERA:era(identity.date),ARTISTDESCRIPTION:[safeDescription(result.artistDescription,`${identity.artist} is the credited artist for ${identity.album}.`)],ALBUMDESCRIPTION:[safeDescription(result.albumDescription,`${identity.album} is an album by ${identity.artist}.`)],DATE:[identity.date||scalar(tags.date)].filter(Boolean),RELEASEDATE:[identity.date||scalar(tags.date)].filter(Boolean)},composers=splitComposerCredits([tags.composer,tags.COMPOSER,tags.AUTHOR].flat()).map(name=>name.toLowerCase()==="billie joe"?"Billie Joe Armstrong":name);properties.COMPOSER=composers;properties.COMPOSERS=[];properties.AUTHOR=[];properties.AUTHORS=[];
        const semantic=db().prepare("SELECT profile_json FROM track_profiles WHERE file_id=? AND status IN ('complete','partial')").get(file.id) as{profile_json:string}|undefined;if(semantic)Object.assign(properties,semanticTagProperties(semantic.profile_json));
        if(writableIdentity){if(identity.artistId){properties.MUSICBRAINZ_ARTISTID=[identity.artistId];properties.MUSICBRAINZ_ALBUMARTISTID=[identity.artistId]}if(identity.releaseGroupId)properties.MUSICBRAINZ_RELEASEGROUPID=[identity.releaseGroupId]}
        const override=db().prepare("SELECT patch_json FROM file_metadata_overrides WHERE file_id=?").get(file.id) as{patch_json:string}|undefined;if(override)Object.assign(properties,JSON.parse(override.patch_json) as Record<string,string[]>);
        try{if(await writeMetadata(file,{properties,coverPath})==="written"){written++;changedFolders.add(dirname(file.path))}}catch(error){fileFailures++;db().prepare("UPDATE files SET status='error',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(file.id);replaceFileIssue(file.id,key,"processing_failed","error",String(error))}
      }
      db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='open' AND code!='processing_failed'").run(key);if(!fileFailures)db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='open' AND code='processing_failed'").run(key);
      if(!writableIdentity&&!manuallyConfirmed)db().prepare("INSERT INTO issues(album_key,code,severity,message) VALUES (?,'identity_unresolved','warning',?)").run(key,`Best identity confidence ${identity.confidence.toFixed(2)}, margin ${identity.margin.toFixed(2)}; no factual IDs written`);
      report({subject,phase:"complete",processedCount:albumIndex+1,totalCount:keys.length});
    }catch(error){const deferred=transientFailure(error),code=deferred?"processing_deferred":"processing_failed",severity=deferred?"warning":"error";db().prepare(`UPDATE files SET status='${deferred?"analyzed":"error"}',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='processing'`).run(key);db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND code IN ('processing_failed','processing_deferred') AND status='open'").run(key);db().prepare("INSERT INTO issues(album_key,code,severity,message) VALUES (?,?,?,?)").run(key,code,severity,String(error))}finally{releaseAlbumLease(key,"write");albums++}
  }
  await rescanFolders([...changedFolders]);return{albums,written};
}
