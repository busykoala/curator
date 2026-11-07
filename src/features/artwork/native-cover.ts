import {relative} from 'node:path';
type LocalFile={path:string};
type NativeFile={albumId:number;path:string};
export function mappedNativeAlbumId(files:LocalFile[],nativeFiles:NativeFile[],musicRoot:string,nativeRoot:string):number|undefined{
 if(!files.length)return undefined;
 const candidates=new Map<number,number>();
 for(const file of files){const path=nativeRoot+'/'+relative(musicRoot,file.path);for(const native of nativeFiles)if(native.path===path)candidates.set(native.albumId,(candidates.get(native.albumId)??0)+1)}
 const complete=[...candidates].filter(([,count])=>count===files.length);
 return complete.length===1?complete[0][0]:undefined;
}
