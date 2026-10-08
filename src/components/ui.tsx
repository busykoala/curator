"use client";
import Link from "next/link";
import { ArrowLeft, Disc3, LoaderCircle, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="page-header-actions">
        {actions}
        <Link
          className="icon-button mobile-account"
          href="/settings"
          aria-label="Account and settings"
        >
          <UserRound />
        </Link>
      </div>
    </header>
  );
}
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="back-link" href={href}>
      <ArrowLeft aria-hidden="true" />
      {children}
    </Link>
  );
}
export function Artwork({
  src,
  alt = "",
  className = "",
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`artwork ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Disc3 aria-label={alt || "Artwork unavailable"} />
      )}
    </span>
  );
}
export function Loading({
  children = "Loading…",
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      {children}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={error ? "inline-error" : "notice-panel"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export const entityHref = (view: string, key: string | number, from?: string) =>
  `/library/${encodeURIComponent(view)}/${encodeURIComponent(String(key))}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
export const nativePlaylistHref = (id: number) =>
  `/api/navidrome/open?playlistId=${id}`;
