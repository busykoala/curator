import { db } from "@/features/db/client";
export const runtime="nodejs";
export function GET(){try{db().prepare("SELECT 1").get();return Response.json({ok:true})}catch(error){return Response.json({ok:false,error:String(error)},{status:503})}}
