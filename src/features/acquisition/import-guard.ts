type Row=Record<string,unknown>;
/** An unsplit image can contaminate the group rejection of valid split tracks. */
export function unmatchedTrackSubset(rows:Row[],item:{albumId?:number;artistId?:number}){
  if(!item.albumId||!rows.some(r=>Array.isArray(r.tracks)&&r.tracks.length===0))return;
  const selected=rows.filter(r=>(r.album as {id?:number})?.id===item.albumId&&Array.isArray(r.tracks)&&r.tracks.length===1);
  if(!selected.length||rows.filter(r=>!selected.includes(r)).some(r=>!Array.isArray(r.tracks)||r.tracks.length!==0))return;
  const tracks=new Set<number>(),releases=new Set<number>();
  for(const r of selected){
    if((item.artistId&&(r.artist as {id?:number})?.id!==item.artistId)||!Array.isArray(r.rejections)||r.rejections.some(x=>(x as {reason?:string}).reason!=='Has unmatched tracks'))return;
    const id=(r.tracks as {id:number}[])[0].id;if(!id||tracks.has(id)||Number(r.albumReleaseId)<=0)return;
    tracks.add(id);releases.add(Number(r.albumReleaseId));
  }
  return releases.size===1?selected:undefined;
}
export function manualImportUpdates(rows:Row[]){return rows.map(r=>({id:r.id,path:r.path,name:r.name,artistId:(r.artist as {id?:number})?.id,albumId:(r.album as {id?:number})?.id,albumReleaseId:r.albumReleaseId,quality:r.quality,releaseGroup:r.releaseGroup,indexerFlags:r.indexerFlags,additionalFile:false,replaceExistingFiles:false,disableReleaseSwitching:true}))}
export function helperFolders(folder:string){
  if(!folder.startsWith('/data/downloads/')||folder.split('/').includes('..'))return [];
  const original=folder.replace(/\/$/,'');
  const stripped=original.replace(/\.(?:tar\.gz|tgz|7z|rar|zip)$/i,'');
  return [...new Set([original,...(stripped.length>'/data/downloads/'.length?[stripped]:[])])];
}
/** Validate a helper's proposed import against fresh, authoritative Lidarr rows. */
export function validateHelperImport(body:Row,queue:Row[],rows:Row[]) {
  if(body.name!=='ManualImport'||!Array.isArray(body.files)||!body.files.length||body.files.length>500)return false;
  const files=body.files as Row[],hash=String(files[0].downloadId??'').toLowerCase();
  const item=queue.find(q=>String(q.downloadId??'').toLowerCase()===hash);
  if(!hash||!item?.albumId||item.status!=='completed'||Number(item.sizeleft)!==0)return false;
  const seenPaths=new Set<string>(),seenTracks=new Set<number>(),releaseIds=new Set<number>();
  for(const file of files){
    const path=String(file.path??'');
    if(!path.startsWith('/data/downloads/')||path.split('/').includes('..')||seenPaths.has(path)||String(file.downloadId??'').toLowerCase()!==hash)return false;
    seenPaths.add(path);
    const row=rows.find(r=>r.path===path),album=row?.album as {id?:number}|undefined,artist=row?.artist as {id?:number}|undefined,tracks=row?.tracks as Array<{id:number}>|undefined;
    if(!row||!Array.isArray(row.rejections)||row.rejections.length||album?.id!==Number(item.albumId)||artist?.id!==Number(item.artistId)||!tracks?.length)return false;
    if(tracks.length!==1||seenTracks.has(tracks[0].id)||Number(file.albumId)!==album.id||Number(file.artistId)!==artist.id||Number(file.albumReleaseId)!==Number(row.albumReleaseId)||Number(row.albumReleaseId)<=0)return false;
    if(JSON.stringify(file.trackIds)!==JSON.stringify(tracks.map(t=>t.id)))return false;
    seenTracks.add(tracks[0].id);releaseIds.add(Number(row.albumReleaseId));
  }
  return releaseIds.size===1;
}
