import { authenticated } from "@/features/auth/session";
import { browseLibrary,browseViews,type BrowseView } from "@/features/library/browse";
import { runtimeSettings } from "@/features/settings/runtime";

export async function GET(request:Request){
  if(!await authenticated())return new Response("Unauthorized",{status:401});
  const params=new URL(request.url).searchParams,view=params.get("view") as BrowseView;
  if(!browseViews.includes(view))return Response.json({error:"Unknown library view"},{status:400});
  const page=Math.max(1,Number(params.get("page")||1)),limit=Math.min(120,Math.max(12,Number(params.get("limit")||runtimeSettings().libraryPageSize)));
  try{return Response.json(await browseLibrary(view,params.get("q")??"",page,limit))}catch(error){return Response.json({error:String(error)},{status:502})}
}
