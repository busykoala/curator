"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { useListener } from "./app-shell";
import { BackLink, Loading, Notice, PageHeader } from "./ui";
import { readJson } from "./http";
type Settings = {
  scanIntervalHours: number;
  enrichmentBatchAlbums: number;
  categorizationBatchAlbums: number;
  libraryPageSize: number;
  stackRefreshSeconds: number;
};
const fields = [
  [
    "scanIntervalHours",
    "Full scan interval",
    1,
    168,
    "Hours between full reconciliations",
  ],
  [
    "enrichmentBatchAlbums",
    "Enrichment batch",
    1,
    24,
    "Albums written before yielding",
  ],
  [
    "categorizationBatchAlbums",
    "Classification batch",
    1,
    64,
    "Albums classified per cycle",
  ],
  [
    "libraryPageSize",
    "Items per library page",
    12,
    120,
    "Shared browsing default",
  ],
  [
    "stackRefreshSeconds",
    "Service refresh",
    5,
    120,
    "Seconds between service checks",
  ],
] as const;
export function SettingsView({ processing = false }: { processing?: boolean }) {
  const { user, appearance, setAppearance } = useListener(),
    [data, setData] = useState<Settings>(),
    [saved, setSaved] = useState(""),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const next = await readJson<Settings>(
        await fetch("/api/settings", { cache: "no-store" }),
      );
      setData(next);
      setSaved(JSON.stringify(next));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings unavailable");
    }
  }, []);
  useEffect(() => {
    if (processing) void load();
  }, [processing, load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await readJson<{ settings: Settings }>(
        await fetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }),
      );
      setData(result.settings);
      setSaved(JSON.stringify(result.settings));
      setNotice(
        "Settings saved. Batch changes apply at the next task boundary.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not be saved");
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    try {
      await readJson(await fetch("/api/auth/logout", { method: "POST" }));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (
          key?.startsWith(`curator-chat-draft:${user.id}:`) ||
          key?.startsWith(`curator-playlist-draft:${user.id}:`) ||
          key?.startsWith(`curator-metadata-draft:${user.id}:`)
        )
          localStorage.removeItem(key);
      }
      location.href = "/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed");
    }
  }
  return (
    <>
      {processing && <BackLink href="/settings">Account and settings</BackLink>}
      <PageHeader
        title={processing ? "Processing settings" : "Account and settings"}
        description={
          processing
            ? "Applies to the shared library, including other listeners."
            : undefined
        }
      />
      {error && (
        <Notice error>
          {error}
          {processing && !data && (
            <button className="text-button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {processing ? (
        !data ? (
          <Loading>Loading processing settings…</Loading>
        ) : (
          <form className="form-stack form-column" onSubmit={save}>
            {fields.map(([key, label, min, max, hint]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  required
                  value={data[key]}
                  onChange={(e) =>
                    setData({ ...data, [key]: Number(e.target.value) })
                  }
                />
                <small>{hint}</small>
              </label>
            ))}
            <button
              className="primary-button"
              disabled={saving || JSON.stringify(data) === saved}
            >
              {saving ? "Saving…" : "Save processing settings"}
            </button>
          </form>
        )
      ) : (
        <>
          <div className="account-identity">
            <span className="avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.displayName}</strong>
              <span>
                {user.tokenStatus === "active"
                  ? "Navidrome account connected"
                  : "Sign in again to reconnect Navidrome"}
              </span>
            </div>
          </div>
          <section className="section form-column">
            <h2>Your preferences</h2>
            <label className="appearance-field">
              <span>Appearance</span>
              <select
                aria-label="Appearance"
                value={appearance}
                disabled={saving}
                onChange={async (e) => {
                  setSaving(true);
                  setError("");
                  try {
                    await setAppearance(
                      e.target.value as "system" | "light" | "dark",
                    );
                    setNotice("Appearance saved.");
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Appearance could not be saved",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <option value="system">Device setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </section>
          <section className="section">
            <h2>Shared library</h2>
            <div className="creation-options">
              <Link className="creation-option" href="/curator">
                <span>
                  <strong>Library care</strong>
                  <small>Review, activity, and service health</small>
                </span>
                <ArrowRight />
              </Link>
              <Link className="creation-option" href="/settings/processing">
                <span>
                  <strong>Processing settings</strong>
                  <small>Scan schedule and library enrichment</small>
                </span>
                <ArrowRight />
              </Link>
            </div>
          </section>
          <button
            className="secondary-button section"
            onClick={() => void logout()}
          >
            <LogOut />
            Sign out
          </button>
        </>
      )}
    </>
  );
}
