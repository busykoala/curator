type Row=Record<string,unknown>;
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
