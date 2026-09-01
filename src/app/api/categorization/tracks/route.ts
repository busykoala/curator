import { authenticated,sameOrigin } from "@/features/auth/session";
import { categorizationSummary,saveProfileOverride,searchProfiles } from "@/features/categorization/query";

export const dynamic="force-dynamic";
export async function GET(request:Request){if(!await authenticated())return new Response("Unauthorized",{status:401});const url=new URL(request.url),search=url.searchParams.get("search")??"",status=url.searchParams.get("status")??"all",limit=Number(url.searchParams.get("limit")??60),offset=Number(url.searchParams.get("offset")??0);return Response.json({summary:categorizationSummary(),rows:searchProfiles(search,status,limit,offset)})}
export async function POST(request:Request){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const body=await request.json() as{fileId?:number;patch?:Record<string,unknown>};if(!Number.isInteger(body.fileId)||!body.patch)return new Response("Invalid override",{status:400});saveProfileOverride(Number(body.fileId),body.patch);return Response.json({ok:true})}catch(error){return Response.json({error:String(error)},{status:400})}}
