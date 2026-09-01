import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Music Curator", description: "Library conservation and enrichment" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" data-theme="archive"><body><div className="grain" />{children}</body></html>; }
