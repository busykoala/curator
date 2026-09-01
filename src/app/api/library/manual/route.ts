import { copyFile,mkdir,rename,rm } from "node:fs/promises";
import { dirname,relative } from "node:path";
import sharp from "sharp";
import { config } from "@/config";
import { authenticated,sameOrigin } from "@/features/auth/session";
import { db,stateSet } from "@/features/db/client";
import { saveManualOverride } from "@/features/manual/overrides";
type Row={path:string;artist_name:string;album_name:string};
const text=(form:FormData,key:string):string|null=>{const value=form.get(key);return typeof value==="string"&&value.trim()?value.trim():null};
async function image(file:FormDataEntryValue|null,target:string):Promise<void>{if(!(file instanceof File)||!file.size)return;if(file.size>20*1024*1024)throw new Error("Image exceeds 20 MB");const bytes=Buffer.from(await file.arrayBuffer()),temp=`${target}.curator-manual`;await mkdir(dirname(target),{recursive:true});try{await sharp(bytes).rotate().resize({width:2000,height:2000,fit:"inside",withoutEnlargement:true}).flatten({background:"#f5f0e6"}).jpeg({quality:90,mozjpeg:true}).toFile(temp);await rename(temp,target)}finally{await rm(temp,{force:true})}}
export async function POST(request:Request){
  if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});
  try{const form=await request.formData(),albumKey=text(form,"albumKey");if(!albumKey)return new Response("Album is required",{status:400});const rows=db().prepare("SELECT path,artist_name,album_name FROM files WHERE album_key=? ORDER BY path").all(albumKey) as Row[];if(!rows.length)return new Response("Album not found",{status:404});const first=rows[0],artist=text(form,"artist")??first.artist_name,album=text(form,"album")??first.album_name;saveManualOverride({album_key:albumKey,artist_name:artist,album_name:album,release_date:text(form,"date"),artist_mbid:text(form,"artistMbid"),release_group_mbid:text(form,"releaseGroupMbid")});
    const cover=form.get("cover"),artistImage=form.get("artistImage"),albumDirs=[...new Set(rows.map(row=>dirname(row.path)))],artistDir=`${config.MUSIC_ROOT}/${relative(config.MUSIC_ROOT,first.path).split("/")[0]}`;if(cover instanceof File&&cover.size){const primary=`${albumDirs[0]}/cover.jpg`;await image(cover,primary);for(const dir of albumDirs.slice(1))await copyFile(primary,`${dir}/cover.jpg`);db().prepare("INSERT OR REPLACE INTO artwork(entity_key,kind,path,provider,source_url,license,width,height) VALUES (?,'cover',?,'manual','manual-upload','personal-library',0,0)").run(albumKey,primary)}if(artistImage instanceof File&&artistImage.size){const target=`${artistDir}/artist.jpg`;await image(artistImage,target);db().prepare("INSERT OR REPLACE INTO artwork(entity_key,kind,path,provider,source_url,license,width,height) VALUES (?,'artist',?,'manual','manual-upload','personal-library',0,0)").run(`artist:${artist}`,target)}
    db().prepare("UPDATE files SET status='analyzed',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status!='processing'").run(albumKey);db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND status='open'").run(albumKey);stateSet("requested_action","run");return Response.json({ok:true,albumKey})
  }catch(error){return Response.json({error:String(error)},{status:400})}
}
