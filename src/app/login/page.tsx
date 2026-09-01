import { redirect } from "next/navigation";
import { authenticated } from "@/features/auth/session";
import { LoginForm } from "@/components/login-form";
export default async function LoginPage() { if (await authenticated()) redirect("/"); return <main className="min-h-screen grid place-items-center p-6"><section className="paper w-full max-w-md p-8"><p className="label text-[var(--teal)]">Private archive</p><h1 className="display text-5xl mt-2 mb-3">Music Curator</h1><p className="opacity-70 mb-8">Sign in to operate the enrichment pipeline.</p><LoginForm /></section></main>; }
