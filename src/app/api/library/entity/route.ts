import { authenticated,sameOrigin } from "@/features/auth/session";
import { db } from "@/features/db/client";
import { browseViews,ensureMetadataOverrides,libraryEntity,type BrowseView } from "@/features/library/browse";

const allowed:Record<string,string>={title:"TITLE",artist:"ARTIST",album:"ALBUM",albumArtist:"ALBUMARTIST",year:"DATE",genre:"GENRE",style:"STYLE",mood:"MOOD",scene:"SCENE",composer:"COMPOSER",label:"LABEL"};
export async function GET(request:Request){if(!await authenticated())return new Response("Unauthorized",{status:401});const p=new URL(request.url).searchParams,view=p.get("view") as BrowseView,key=p.get("key")??"";if(!browseViews.includes(view)||!key)return Response.json({error:"Invalid entity"},{status:400});try{const entity=await libraryEntity(view,key);return entity?Response.json(entity):Response.json({error:"Not found"},{status:404})}catch(error){return Response.json({error:String(error)},{status:502})}}
export async function PATCH(request:Request){
  if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});
  try{
    const body=await request.json() as{fileIds?:number[];patch?:Record<string,unknown>};if(!body.fileIds?.length||!body.patch)return Response.json({error:"Files and changes are required"},{status:400});
    ensureMetadataOverrides();const normalized:Record<string,string[]>={};for(const[key,value]of Object.entries(body.patch)){const field=allowed[key];if(!field)continue;normalized[field]=Array.isArray(value)?value.map(String).map(v=>v.trim()).filter(Boolean):String(value??"").split(";").map(v=>v.trim()).filter(Boolean)}
    const transaction=db().transaction(()=>{for(const id of body.fileIds!.slice(0,2000)){const existing=db().prepare("SELECT patch_json FROM file_metadata_overrides WHERE file_id=?").get(id) as{patch_json:string}|undefined,patch={...(existing?JSON.parse(existing.patch_json):{}),...normalized};db().prepare("INSERT INTO file_metadata_overrides(file_id,patch_json) VALUES (?,?) ON CONFLICT(file_id) DO UPDATE SET patch_json=excluded.patch_json,updated_at=CURRENT_TIMESTAMP").run(id,JSON.stringify(patch));db().prepare("UPDATE files SET status='analyzed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)}});transaction();return Response.json({queued:body.fileIds.length,fields:Object.keys(normalized)});
  }catch(error){return Response.json({error:String(error)},{status:400})}
}
