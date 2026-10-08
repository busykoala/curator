import type { Metadata } from "next";
import "./globals.css";
import "./app-shell.css";
export const metadata: Metadata = {
  title: { default: "Curator", template: "%s · Curator" },
  description: "Find, shape, and care for music in your collection",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
