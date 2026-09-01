import { createSession,sameOrigin,verifyPassword } from "@/features/auth/session";
export const runtime="nodejs";
export async function POST(request:Request){if(!sameOrigin(request))return new Response("Invalid origin",{status:403});const{password}=await request.json() as{password?:string};const ip=request.headers.get("x-forwarded-for")?.split(",")[0]??"local";if(!password||!await verifyPassword(password,ip))return new Response("Unauthorized",{status:401});await createSession();return Response.json({ok:true})}
