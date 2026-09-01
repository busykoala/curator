import { readFile,rename,unlink,writeFile } from "node:fs/promises";
import { dirname,join,extname } from "node:path";
import sharp from "sharp";
import { authenticated,sameOrigin } from "@/features/auth/session";
import { db } from "@/features/db/client";

export async function GET(request:Request){
  if(!await authenticated())return new Response("Unauthorized",{status:401});
  const p=new URL(request.url).searchParams,id=Number(p.get("fileId")),kind=p.get("kind")==="artist"?"artist":"album";if(!Number.isInteger(id))return new Response(null,{status:404});
  const row=db().prepare("SELECT path FROM files WHERE id=?").get(id) as{path:string}|undefined;if(!row)return new Response(null,{status:404});
  const albumDir=dirname(row.path),artistDir=dirname(albumDir),candidates=kind==="artist"?[join(artistDir,"artist.jpg"),join(artistDir,"artist.jpeg"),join(artistDir,"artist.png")]:[join(albumDir,"cover.jpg"),join(albumDir,"folder.jpg"),join(albumDir,"front.jpg"),join(albumDir,"cover.png")];
  for(const path of candidates)try{const body=await readFile(path),extension=extname(path).toLowerCase();return new Response(body,{headers:{"Content-Type":extension===".png"?"image/png":"image/jpeg","Cache-Control":"private, max-age=3600"}})}catch{}
  return new Response(null,{status:404});
}

export async function POST(request:Request){
  if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});
  try{const form=await request.formData(),id=Number(form.get("fileId")),kind=form.get("kind")==="artist"?"artist":"album",upload=form.get("image");if(!Number.isInteger(id)||!(upload instanceof File))return Response.json({error:"Image and library item are required"},{status:400});if(upload.size>20*1024*1024)return Response.json({error:"Image exceeds 20 MB"},{status:400});const row=db().prepare("SELECT path FROM files WHERE id=?").get(id) as{path:string}|undefined;if(!row)return Response.json({error:"Library item not found"},{status:404});const input=Buffer.from(await upload.arrayBuffer()),metadata=await sharp(input).metadata();if(!metadata.width||!metadata.height||Math.min(metadata.width,metadata.height)<300)return Response.json({error:"Image must be at least 300 pixels on its shortest side"},{status:400});const directory=kind==="artist"?dirname(dirname(row.path)):dirname(row.path),target=join(directory,kind==="artist"?"artist.jpg":"cover.jpg"),temporary=join(directory,`.curator-upload-${process.pid}-${Date.now()}.jpg`),output=await sharp(input).rotate().resize({width:2000,height:2000,fit:"inside",withoutEnlargement:true}).flatten({background:"#111111"}).jpeg({quality:91,mozjpeg:true}).toBuffer();try{await writeFile(temporary,output,{flag:"wx"});await rename(temporary,target)}catch(error){await unlink(temporary).catch(()=>{});throw error}db().prepare("UPDATE files SET status='analyzed',updated_at=CURRENT_TIMESTAMP WHERE id=? OR album_key=(SELECT album_key FROM files WHERE id=?)").run(id,id);return Response.json({saved:true,width:metadata.width,height:metadata.height})}catch(error){return Response.json({error:String(error)},{status:400})}
}
