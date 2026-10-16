import { album,releaseTracks,importFiles,manualImport,manualImportFolder,recheckManualImport,type QueueItem } from "./lidarr";
import {helperFolders,unmatchedTrackSubset,manualImportUpdates} from './import-guard';
import {acceptsProvenImport,proveRelease,type ImportProof,type ImportRow} from './import-proof';

export type ExactManualImport={albumId:number;artistId?:number;artist?:string;album?:string;recovery?:string};

async function recoverCompleteRelease(rows:Record<string,unknown>[],item:QueueItem,onReview?:(detail:Record<string,unknown>)=>void){
  if(!item.albumId||!item.artistId||item.status!=='completed'||Number(item.sizeleft)!==0||!item.downloadId)return;
  const folders=helperFolders(item.outputPath??'');
  if(!folders.length||rows.some(r=>typeof r.path!=='string'||!folders.some(f=>String(r.path).startsWith(f+'/'))))return;
  const metadata=await album(item.albumId);
  if(!metadata.monitored||metadata.artistId!==item.artistId||Number(metadata.statistics?.percentOfTracks??0)>=100)return;
  const artist=String((rows.find(r=>(r.artist as {id?:number})?.id===item.artistId)?.artist as {artistName?:string})?.artistName??'');
  if(!artist)return;
  const releases=(metadata.releases??[]).filter(r=>r.id&&r.trackCount&&[rows.length,rows.length-1].includes(r.trackCount)&&(metadata.anyReleaseOk!==false||r.monitored));
  if(!releases.length){onReview?.({reason:/box\s*set/i.test(metadata.disambiguation??'')?'Downloaded audio does not match the requested box set':'Download does not contain a complete selectable catalogue edition',downloadFiles:rows.length,expectedTrackCounts:[...new Set((metadata.releases??[]).map(r=>r.trackCount))],catalogueDisambiguation:metadata.disambiguation});return}
  const proofs:ImportProof[]=[];
  for(const release of releases.slice(0,20)){
    const proof=proveRelease(rows as ImportRow[],await releaseTracks(release.id!),release.id!,metadata.id,metadata.artistId,artist);
    if(proof)proofs.push(proof);
  }
  // Equivalent pressings are ranked by measured durations. If the evidence
  // could represent different recordings, leave the download for review.
  const recordings=new Set(proofs.map(p=>JSON.stringify(p.files.map(f=>[f.row.path,f.track.foreignRecordingId??f.track.title]).sort())));
  if(recordings.size>1)return;
  proofs.sort((a,b)=>a.durationError-b.durationError||a.releaseId-b.releaseId);
  for(const proof of proofs.slice(0,3)){
    const selected=proof.files.map(({row})=>({...row,artist:{id:item.artistId},album:{id:item.albumId},albumReleaseId:proof.releaseId}));
    const checked=await recheckManualImport(manualImportUpdates(selected));
    if(acceptsProvenImport(checked,proof,item.albumId,item.artistId))return checked;
  }
}

export async function exactManualImport(item:QueueItem,onReview?:(detail:Record<string,unknown>)=>void):Promise<ExactManualImport|false>{
  if(!item.downloadId)return false;
  let rows=await manualImport(item.downloadId);
  if(!rows.length)for(const folder of helperFolders(item.outputPath??'')){
    rows=await manualImportFolder(folder,item.artistId);
    if(rows.length)break;
  }
  // Queue counts describe the currently selected catalogue edition, not the
  // downloaded one (e.g. 19 deluxe tracks versus 11 standard tracks). Fresh
  // release IDs, unique tracks and rejection checks below decide the mapping.
  if(!rows.length)return false;
  const subset=unmatchedTrackSubset(rows,item);
  if(subset)rows=await recheckManualImport(manualImportUpdates(subset));
  let proven=false;
  if(rows.some(r=>(r.rejections as unknown[]|undefined)?.length)){
    const recovered=await recoverCompleteRelease(rows,item,onReview).catch(()=>undefined);
    if(recovered){rows=recovered;proven=true}
  }
  const albumIds=new Set<number>(),artistIds=new Set<number>(),trackIds=new Set<number>(),releaseIds=new Set<number>();
  for(const row of rows){
    const rejections=row.rejections as unknown[]|undefined,tracks=row.tracks as Array<{id?:number}>|undefined,album=row.album as{id?:number}|undefined,artist=row.artist as{id?:number}|undefined,albumReleaseId=Number(row.albumReleaseId);
    if((rejections?.length&&!proven)||tracks?.length!==1||!album?.id||!tracks[0].id||trackIds.has(tracks[0].id)||!Number.isInteger(albumReleaseId)||albumReleaseId<=0)return false;
    if(item.artistId&&artist?.id!==item.artistId)return false;
    albumIds.add(album.id);if(artist?.id)artistIds.add(artist.id);trackIds.add(tracks[0].id);releaseIds.add(albumReleaseId);
  }
  if(albumIds.size!==1||artistIds.size>1||releaseIds.size!==1)return false;
  const albumId=[...albumIds][0];
  if(item.albumId&&item.albumId!==albumId)return false;
  const files=rows.map(row=>({path:row.path,artistId:(row.artist as{id?:number})?.id,albumId,albumReleaseId:Number(row.albumReleaseId),trackIds:(row.tracks as Array<{id:number}>).map(track=>track.id),quality:row.quality,downloadId:item.downloadId}));
  await importFiles(files);
  const first=rows[0];
  return{albumId,artistId:[...artistIds][0],artist:String((first.artist as{artistName?:string}|undefined)?.artistName??""),album:String((first.album as{title?:string}|undefined)?.title??""),...(proven?{recovery:'Complete catalogue track list, positions and durations independently verified; native track mapping agrees'}:{})};
}
