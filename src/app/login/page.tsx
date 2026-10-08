import { loginDestination } from "@/features/auth/destination";
import { redirect } from "next/navigation";
import { authenticated } from "@/features/auth/session";
import { LoginForm } from "@/components/login-form";
import { Disc3 } from "lucide-react";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next,
    destination = loginDestination(next);
  if (await authenticated()) redirect(destination);
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          <Disc3 />
          <strong>Curator</strong>
        </div>
        <h1>Sign in</h1>
        <p>Use your Navidrome account.</p>
        <LoginForm destination={destination} />
        <footer>
          Need an account? Ask the person who manages your music library.
        </footer>
      </section>
    </main>
  );
}
