import { redirect } from "next/navigation";
import { authenticated } from "@/features/auth/session";
import { LoginForm } from "@/components/login-form";
export default async function LoginPage() { if (await authenticated()) redirect("/home"); return <main className="login-page"><section className="login-card"><span className="kicker">Private music archive</span><h1>Music Curator</h1><p>Use your Navidrome account to shape playlists, request albums, and rediscover your library.</p><LoginForm /></section></main>; }
