"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Disc3, House, Library, ListMusic } from "lucide-react";
import type { CuratorUser } from "@/features/auth/session";
import { readJson } from "./http";
type Appearance = "system" | "light" | "dark";
const ListenerContext = createContext<{
  user: CuratorUser;
  appearance: Appearance;
  setAppearance: (value: Appearance) => Promise<void>;
} | null>(null);
export function useListener() {
  const listener = useContext(ListenerContext);
  if (!listener) throw new Error("Listener context is missing");
  return listener;
}
const destinations = [
  { href: "/home", name: "Home", icon: House },
  { href: "/library", name: "Library", icon: Library },
  { href: "/playlists", name: "Playlists", icon: ListMusic },
];
export function AppShell({
  user,
  children,
}: {
  user: CuratorUser;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    [appearance, updateAppearance] = useState<Appearance>("system");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/preferences", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => readJson<{ appearance: Appearance }>(response))
      .then((value) => updateAppearance(value.appearance))
      .catch(() => {});
    return () => controller.abort();
  }, [user.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);
  async function setAppearance(value: Appearance) {
    await readJson(
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appearance: value }),
      }),
    );
    updateAppearance(value);
  }
  const active =
    path.startsWith("/add") || path.startsWith("/requests")
      ? "/library"
      : destinations.find((item) => path.startsWith(item.href))?.href;
  const links = destinations.map(({ href, name, icon: Icon }) => (
    <Link
      key={href}
      href={href}
      className={active === href ? "active" : ""}
      aria-current={active === href ? "page" : undefined}
    >
      <Icon aria-hidden="true" />
      <span>{name}</span>
    </Link>
  ));
  return (
    <ListenerContext.Provider value={{ user, appearance, setAppearance }}>
      <div className="app-frame">
        <a className="skip-link" href="#page-content">
          Skip to content
        </a>
        <aside className="app-sidebar">
          <Link className="brand" href="/home">
            <Disc3 aria-hidden="true" />
            <strong>Curator</strong>
          </Link>
          <nav aria-label="Primary">{links}</nav>
          <Link className="account-panel" href="/settings">
            <span className="avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.displayName}</strong>
              <small>Account &amp; settings</small>
            </span>
          </Link>
        </aside>
        <main className="app-content" id="page-content">
          <div className="app-page">{children}</div>
        </main>
        <nav className="mobile-nav" aria-label="Primary">
          {links}
        </nav>
      </div>
    </ListenerContext.Provider>
  );
}
