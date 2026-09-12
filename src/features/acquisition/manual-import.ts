import { importFiles,manualImport,type QueueItem } from "./lidarr";

export type ExactManualImport={albumId:number;artistId?:number;artist?:string;album?:string};

export async function exactManualImport(item:QueueItem):Promise<ExactManualImport|false>{
  if(!item.downloadId)return false;
  const rows=await manualImport(item.downloadId);
  if(!rows.length||rows.length!==Number(item.trackFileCount??rows.length))return false;
  const albumIds=new Set<number>(),artistIds=new Set<number>(),trackIds=new Set<number>();
  for(const row of rows){
    const rejections=row.rejections as unknown[]|undefined,tracks=row.tracks as Array<{id?:number}>|undefined,album=row.album as{id?:number}|undefined,artist=row.artist as{id?:number}|undefined,albumReleaseId=Number(row.albumReleaseId);
    if(rejections?.length||tracks?.length!==1||!album?.id||!tracks[0].id||trackIds.has(tracks[0].id)||!Number.isInteger(albumReleaseId)||albumReleaseId<=0)return false;
    albumIds.add(album.id);if(artist?.id)artistIds.add(artist.id);trackIds.add(tracks[0].id);
  }
  if(albumIds.size!==1||artistIds.size>1)return false;
  const albumId=[...albumIds][0];
  if(item.albumId&&item.albumId!==albumId)return false;
  const files=rows.map(row=>({path:row.path,artistId:(row.artist as{id?:number})?.id,albumId,albumReleaseId:Number(row.albumReleaseId),trackIds:(row.tracks as Array<{id:number}>).map(track=>track.id),quality:row.quality,downloadId:item.downloadId}));
  await importFiles(files);
  const first=rows[0];
  return{albumId,artistId:[...artistIds][0],artist:String((first.artist as{artistName?:string}|undefined)?.artistName??""),album:String((first.album as{title?:string}|undefined)?.title??"")};
}
