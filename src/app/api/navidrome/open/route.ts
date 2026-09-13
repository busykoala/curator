import { redirect } from "next/navigation";
import { config } from "@/config";
import { authenticated } from "@/features/auth/session";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});redirect(`${config.NAVIDROME_PUBLIC_URL.replace(/\/$/,"")}/app/#/playlist`)}
