import {config} from '@/config';
import {db,stateGet,stateSet} from '@/features/db/client';
import {getManualOverride} from '@/features/manual/overrides';
import {albumKey} from '@/features/scanner/normalize';
import {album,artist,artists,releaseTracks,trackFilesByArtist} from './lidarr';
import {libraryNativePath,queueImportedIdentity} from './imported-identity';
import type {ReleaseTrack} from './import-proof';

export type LocalFile={path:string;album_key:string;artist_name:string;album_name:string;durationMs:number|null};
export type NativeFile={id:number;albumId:number;path:string};
export type NativePlan={rejected:string}|{
  releaseGroupId:string;albumName:string;split:boolean;
  albums:Array<{albumKey:string;artistName:string}>;
};

const DURATION_TOLERANCE_MS=5_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISC_SUFFIX=/[\s._-]*[([{]?\s*(?:cd|disc|disk|vinyl|part)\s*0*\d+\s*[)\]}]?\s*$/i;

/** "Blue Train: The Complete Masters CD1" -> "Blue Train: The Complete Masters". */
export function discBaseName(name:string){return name.replace(DISC_SUFFIX,'').trim()||name.trim()}

/**
 * Decide whether Lidarr's own file mapping proves an album's identity. Every
 * local file of every involved Curator album must be mapped by exact path to
 * one complete Lidarr release, with each measured duration within 5 seconds of
 * the catalogue track. Anything weaker is rejected, never guessed.
 */
export function planNativeConfirmation(input:{
  files:LocalFile[];native:NativeFile[];tracks:ReleaseTrack[];
  album:{id:number;title:string;foreignAlbumId?:string;percentOfTracks?:number};
}):NativePlan{
  const {files,native,tracks,album:a}=input;
  if(!files.length)return{rejected:'no local files'};
  if(!a.foreignAlbumId||!UUID.test(a.foreignAlbumId))return{rejected:'native album has no release-group id'};
  if(Number(a.percentOfTracks??0)<100)return{rejected:'native album incomplete'};
  if(tracks.length!==files.length)return{rejected:`track count ${files.length} local vs ${tracks.length} native`};
  const byPath=new Map(native.map(file=>[file.path,file])),byFile=new Map(tracks.filter(t=>t.trackFileId).map(t=>[t.trackFileId!,t]));
  const used=new Set<number>();
  for(const file of files){
    let nativePath:string;try{nativePath=libraryNativePath(file.path)}catch{return{rejected:'file outside library'}}
    const mapped=byPath.get(nativePath);
    if(!mapped||mapped.albumId!==a.id)return{rejected:`unmapped file ${file.path}`};
    const track=byFile.get(mapped.id);
    if(!track||used.has(track.id))return{rejected:`no unique native track for ${file.path}`};
    used.add(track.id);
    if(!file.durationMs||!track.duration||Math.abs(file.durationMs-track.duration)>DURATION_TOLERANCE_MS)return{rejected:`duration mismatch for ${file.path}`};
  }
  const keys=[...new Set(files.map(file=>file.album_key))],split=keys.length>1;
  const names=[...new Set(files.map(file=>discBaseName(file.album_name)))];
  const albumName=split?(names.length===1?names[0]:a.title):files[0].album_name;
  return{releaseGroupId:a.foreignAlbumId,albumName,split,albums:keys.map(key=>({albumKey:key,artistName:files.find(file=>file.album_key===key)!.artist_name}))};
}

type Candidate={album_key:string;fingerprint:string};
function candidates(limit:number):Candidate[]{
  // Unresolved identities, plus albums named like a single disc of a set.
  return db().prepare(`SELECT f.album_key,count(*)||':'||max(f.mtime_ms) fingerprint FROM files f
    WHERE f.status!='processing' AND NOT EXISTS (SELECT 1 FROM manual_overrides m WHERE m.album_key=f.album_key AND m.confirmed=1)
      AND (EXISTS (SELECT 1 FROM issues i WHERE i.album_key=f.album_key AND i.status='open' AND i.code='identity_unresolved')
        OR f.album_name GLOB '*[Cc][Dd] [0-9]*' OR f.album_name GLOB '*[Cc][Dd][0-9]*' OR f.album_name GLOB '*[Dd]isc [0-9]*')
    GROUP BY f.album_key LIMIT ?`).all(limit) as Candidate[];
}
const localFiles=(where:string,...args:unknown[])=>(db().prepare(`SELECT path,album_key,artist_name,album_name,json_extract(properties_json,'$.durationMs') durationMs FROM files WHERE ${where}`).all(...args) as LocalFile[]);

export async function confirmNativeIdentities(limit=5){
  const found=candidates(limit*4);if(!found.length)return 0;
  const lidarrArtists=await artists();
  const byFolder=new Map(lidarrArtists.map(a=>[String(a.path??'').split('/').pop()!,a]));
  let confirmed=0;
  for(const candidate of found){
    if(confirmed>=limit)break;
    const checked=`native_identity_checked:${candidate.album_key}`;
    if(stateGet(checked)===candidate.fingerprint)continue;
    stateSet(checked,candidate.fingerprint);
    const seed=localFiles('album_key=?',candidate.album_key);
    const folder=seed[0]?.path.slice(config.MUSIC_ROOT.length+1).split('/')[0];
    const lidarrArtist=folder?byFolder.get(folder):undefined;if(!lidarrArtist)continue;
    const nativeFiles=(await trackFilesByArtist(lidarrArtist.id)) as NativeFile[];
    const seedNative=new Set(seed.map(file=>{try{return nativeFiles.find(n=>n.path===libraryNativePath(file.path))?.albumId}catch{return undefined}}));
    if(seedNative.size!==1||[...seedNative][0]==null)continue;
    const albumId=[...seedNative][0]!,a=await album(albumId),release=a.releases?.find(r=>r.monitored);
    if(!release?.id)continue;
    const albumPaths=nativeFiles.filter(n=>n.albumId===albumId).map(n=>n.path.replace(config.LIDARR_MUSIC_ROOT,config.MUSIC_ROOT));
    const files=albumPaths.length?localFiles(`path IN (${albumPaths.map(()=>'?').join(',')})`,...albumPaths):[];
    const plan=planNativeConfirmation({files,native:nativeFiles,tracks:await releaseTracks(release.id),album:{id:a.id,title:release.title||a.title,foreignAlbumId:a.foreignAlbumId,percentOfTracks:a.statistics?.percentOfTracks}});
    if('rejected' in plan){console.log(JSON.stringify({event:'native_identity_rejected',albumKey:candidate.album_key,reason:plan.rejected}));continue}
    const ar=await artist(a.artistId),artistMbid=UUID.test(String(ar.foreignArtistId??''))?String(ar.foreignArtistId):null;
    const insert=db().prepare("INSERT INTO manual_overrides(album_key,artist_name,album_name,release_date,artist_mbid,release_group_mbid,confirmed) VALUES (?,?,?,NULL,?,?,1) ON CONFLICT(album_key) DO NOTHING");
    db().transaction(()=>{
      for(const local of plan.albums){
        if(getManualOverride(local.albumKey))continue; // never replace an operator's override
        insert.run(local.albumKey,local.artistName,plan.albumName,artistMbid,plan.releaseGroupId);
        // After a disc merge the rescanned files land on the merged key; confirm it too.
        if(plan.split)insert.run(albumKey(local.artistName,plan.albumName),local.artistName,plan.albumName,artistMbid,plan.releaseGroupId);
        db().prepare("UPDATE files SET status='analyzed',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status!='processing'").run(local.albumKey);
        db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='open' AND code='identity_unresolved'").run(local.albumKey);
      }
      db().prepare("INSERT INTO evidence(provider,source_id,entity_key,payload_json,expires_at) VALUES ('lidarr-native',?,?,?,datetime('now','+3650 days')) ON CONFLICT(provider,source_id) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=CURRENT_TIMESTAMP")
        .run(String(albumId),candidate.album_key,JSON.stringify({albumId,releaseId:release.id,releaseGroupId:plan.releaseGroupId,albumName:plan.albumName,split:plan.split,files:files.length,toleranceMs:DURATION_TOLERANCE_MS}));
    })();
    // A split album also needs disc numbers; the verified backfill fills only missing tags.
    if(plan.split)queueImportedIdentity({albumId:a.id,artistId:a.artistId,releaseId:release.id,artist:String(ar.artistName),album:plan.albumName,date:a.releaseDate,trackIds:(await releaseTracks(release.id)).map(t=>t.id)});
    stateSet('requested_action','run');
    console.log(JSON.stringify({event:'native_identity_confirmed',albumId,albums:plan.albums.length,split:plan.split}));
    confirmed++;
  }
  return confirmed;
}
