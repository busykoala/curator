import { authenticated,clearSession,sameOrigin } from "@/features/auth/session";
export async function POST(request:Request){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});await clearSession();return Response.json({ok:true})}
