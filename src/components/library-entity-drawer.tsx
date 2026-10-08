"use client";
import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { ExternalLink, Pencil, Upload } from "lucide-react";
import {
  Artwork,
  BackLink,
  Loading,
  Notice,
  PageHeader,
  entityHref,
} from "./ui";
import { useListener } from "./app-shell";
import { useSearchParams } from "next/navigation";
import { readJson } from "./http";
type Track = {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumKey: string;
  track: number;
  disc: number;
  year: string;
  path: string;
  status: string;
  tags: Record<string, unknown>;
  profile: Record<string, unknown> | null;
};
type Entity = {
  view: string;
  key: string;
  title: string;
  subtitle: string;
  artwork: string;
  summary: {
    artist: string;
    album: string;
    year: string;
    genres: string[];
    styles: string[];
    moods: string[];
    scenes: string[];
    labels: string[];
  };
  tracks: Track[];
};
const labels: Record<string, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  albumArtist: "Album artist",
  year: "Release year",
  composer: "Composer",
  label: "Record label",
  genre: "Genres",
  style: "Styles",
  mood: "Moods",
  scene: "Scenes",
};
const one = (value: unknown) =>
  Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
export function LibraryEntityView({
  view,
  entityKey,
  editing = false,
  from = "/library",
}: {
  view: string;
  entityKey: string;
  editing?: boolean;
  from?: string;
}) {
  const { user } = useListener(),
    params = useSearchParams();
  const draftKey = `curator-metadata-draft:${user.id}:${view}:${entityKey}`;
  const restoredDraft = useRef(false);
  const [entity, setEntity] = useState<Entity>(),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState(""),
    [queued, setQueued] = useState(false),
    [uploading, setUploading] = useState(false),
    [form, setForm] = useState<Record<string, string>>({}),
    [original, setOriginal] = useState("");
  const href = entityHref(view, entityKey, from),
    back =
      from.startsWith("/library") && !from.startsWith("//") ? from : "/library";
  const load = useCallback(async () => {
    const result = await readJson<Entity>(
      await fetch(
        `/api/library/entity?view=${encodeURIComponent(view)}&key=${encodeURIComponent(entityKey)}`,
        { cache: "no-store" },
      ),
    );
    setEntity(result);
    return result;
  }, [view, entityKey]);
  useEffect(() => {
    let active = true;
    setEntity(undefined);
    setError("");
    void load().catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    restoredDraft.current = false;
  }, [editing, draftKey]);
  useEffect(() => {
    if (!entity || queued) return;
    const track = entity.tracks[0],
      tags = track?.tags ?? {};
    const next = {
      title: one(tags.title) || track?.title || "",
      artist: one(tags.artist) || track?.artist || "",
      album: one(tags.album) || track?.album || "",
      albumArtist: one(tags.albumArtist) || entity.summary.artist,
      year: entity.summary.year,
      genre: entity.summary.genres.join("; "),
      style: entity.summary.styles.join("; "),
      mood: entity.summary.moods.join("; "),
      scene: entity.summary.scenes.join("; "),
      composer: one(tags.composer),
      label: entity.summary.labels.join("; "),
    };
    if (editing && !restoredDraft.current) {
      restoredDraft.current = true;
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) ?? "null");
        if (
          draft &&
          Object.keys(next).every((key) => typeof draft[key] === "string")
        ) {
          setForm(draft);
          setOriginal(JSON.stringify(next));
          return;
        }
      } catch {}
    }
    setForm(next);
    setOriginal(JSON.stringify(next));
  }, [entity, queued, editing, draftKey]);
  useEffect(() => {
    if (editing && original && !queued) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(form));
      } catch {}
    }
  }, [form, original, queued, editing, draftKey]);
  const dirty = editing && JSON.stringify(form) !== original;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!queued) return;
    let active = true;
    const timer = setInterval(() => {
      void load()
        .then((result) => {
          if (!active) return;
          if (result.tracks.some((item) => item.status === "error")) {
            setStatus("Some file updates failed. Review Activity for details.");
            setQueued(false);
          } else if (result.tracks.every((item) => item.status === "written")) {
            setStatus("File updates completed.");
            setQueued(false);
          }
        })
        .catch(() => {});
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [queued, load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!entity) return;
    setSaving(true);
    setError("");
    try {
      const fileIds =
          view === "albums"
            ? entity.tracks.map((t) => t.id)
            : [entity.tracks[0].id],
        keys =
          view === "albums"
            ? [
                "album",
                "albumArtist",
                "year",
                "genre",
                "style",
                "mood",
                "scene",
                "label",
              ]
            : Object.keys(form);
      await readJson(
        await fetch("/api/library/entity", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileIds,
            patch: Object.fromEntries(keys.map((key) => [key, form[key]])),
          }),
        }),
      );
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setOriginal(JSON.stringify(form));
      setQueued(true);
      setStatus("Changes queued. File updates will run in the background.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }
  async function upload(file: File) {
    if (!entity) return;
    setUploading(true);
    setError("");
    try {
      const data = new FormData();
      data.set("fileId", String(entity.tracks[0].id));
      data.set("kind", "album");
      data.set("image", file);
      await readJson(
        await fetch("/api/library/artwork", { method: "POST", body: data }),
      );
      setEntity({
        ...entity,
        artwork: entity.artwork + "&manual=" + Date.now(),
      });
      setStatus("Artwork saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Artwork update failed");
    } finally {
      setUploading(false);
    }
  }
  const albums = useMemo(
    () => [
      ...new Map((entity?.tracks ?? []).map((t) => [t.albumKey, t])).values(),
    ],
    [entity],
  );
  if (!entity)
    return (
      <>
        <BackLink href={back}>Library</BackLink>
        {error ? (
          <Notice error>
            {error}
            <button
              className="text-button"
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              Retry
            </button>
          </Notice>
        ) : (
          <Loading>Loading details…</Loading>
        )}
      </>
    );
  const fields = (keys: string[]) =>
    keys.map((key) => (
      <label key={key}>
        <span>{labels[key]}</span>
        <input
          value={form[key] ?? ""}
          onChange={(e) =>
            setForm((current) => ({ ...current, [key]: e.target.value }))
          }
        />
      </label>
    ));
  if (editing && ["albums", "songs"].includes(view))
    return (
      <>
        <BackLink href={href}>
          Back to {view === "albums" ? "album" : "song"}
        </BackLink>
        <PageHeader
          title={view === "albums" ? "Edit album details" : "Edit song details"}
        />
        <form className="form-stack form-column" onSubmit={save}>
          <p className="muted">
            {view === "albums"
              ? `Changes apply to all ${entity.tracks.length} songs in this album.`
              : "Changes apply to this song only."}{" "}
            File updates run in the background.
          </p>
          {params.get("native") === "unavailable" && (
            <Notice>
              This album could not be found in Navidrome.{" "}
              <a href="/api/navidrome/open" target="_blank" rel="noreferrer">
                Open Navidrome
              </a>
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
          {status && (
            <Notice>
              {status}{" "}
              {queued && <Link href="/curator/activity">View activity</Link>}
            </Notice>
          )}
          <div className="field-grid">
            {fields(
              view === "albums"
                ? ["album", "albumArtist", "year", "genre"]
                : ["title", "artist", "album", "albumArtist", "year", "genre"],
            )}
          </div>
          <details>
            <summary>More metadata</summary>
            <div className="field-grid">
              {fields(
                view === "albums"
                  ? ["label", "style", "mood", "scene"]
                  : ["composer", "label", "style", "mood", "scene"],
              )}
            </div>
            <label className="upload-control">
              <Upload />
              Change artwork
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) =>
                  e.target.files?.[0] && void upload(e.target.files[0])
                }
              />
            </label>
          </details>
          <div className="button-row">
            <button
              className="primary-button"
              disabled={saving || uploading || queued || !dirty}
            >
              {saving
                ? "Queueing…"
                : queued
                  ? "Updates queued"
                  : view === "albums"
                    ? "Save album details"
                    : "Save song details"}
            </button>
            <Link
              className="secondary-button"
              href={href}
              onClick={(e) => {
                if (
                  dirty &&
                  !confirm("Leave without saving these metadata changes?")
                )
                  e.preventDefault();
                else {
                  try {
                    localStorage.removeItem(draftKey);
                  } catch {}
                }
              }}
            >
              Cancel
            </Link>
          </div>
        </form>
      </>
    );
  return (
    <>
      <BackLink href={back}>Library</BackLink>
      {params.get("native") === "unavailable" && (
        <Notice>
          This album could not be found in Navidrome.{" "}
          <a href="/api/navidrome/open" target="_blank" rel="noreferrer">
            Open Navidrome
          </a>
        </Notice>
      )}
      <div className="entity-hero">
        <Artwork src={entity.artwork} alt={`${entity.title} artwork`} />
        <div>
          <span className="eyebrow">
            {view === "albums"
              ? "Album"
              : view === "songs"
                ? "Song"
                : view === "artists"
                  ? "Artist"
                  : view.slice(0, -1)}
            {entity.summary.year && view !== "artists"
              ? ` · ${entity.summary.year}`
              : ""}
          </span>
          <PageHeader title={entity.title} />
          {["albums", "songs"].includes(view) && (
            <Link
              className="text-link"
              href={entityHref("artists", entity.summary.artist, back)}
            >
              {entity.summary.artist}
            </Link>
          )}
          {view === "songs" && (
            <Link
              className="text-link"
              href={entityHref("albums", entity.tracks[0].albumKey, back)}
            >
              {entity.summary.album}
            </Link>
          )}
          <div className="tag-row">
            {entity.summary.genres.map((g) => (
              <Link
                className="filter-chip"
                key={g}
                href={"/library?genre=" + encodeURIComponent(g)}
              >
                {g}
              </Link>
            ))}
          </div>
          <div className="button-row">
            {["albums", "songs"].includes(view) && (
              <a
                className="primary-button"
                href={`/api/navidrome/open?fileId=${entity.tracks[0].id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Navidrome
                <ExternalLink />
              </a>
            )}
            {["albums", "songs"].includes(view) && (
              <Link
                className="secondary-button"
                href={`${href}${href.includes("?") ? "&" : "?"}edit=1`}
              >
                <Pencil />
                Edit details
              </Link>
            )}
          </div>
        </div>
      </div>
      {!["albums", "songs"].includes(view) && (
        <section className="section">
          <div className="section-heading">
            <h2>Albums</h2>
          </div>
          <div className="media-grid">
            {albums.map((t) => (
              <Link
                className="media-card"
                key={t.albumKey}
                href={entityHref("albums", t.albumKey, back)}
              >
                <Artwork
                  src={`/api/library/artwork?fileId=${t.id}&kind=album`}
                />
                <span className="media-copy">
                  <strong>{t.album}</strong>
                  <span>{t.artist}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <div className="section-heading">
          <h2>{view === "songs" ? "Song details" : "Songs"}</h2>
          <span className="muted">
            {entity.tracks.length}{" "}
            {entity.tracks.length === 1 ? "song" : "songs"}
          </span>
        </div>
        <div className="song-list">
          {entity.tracks.map((t, index) => (
            <article className="song-row" key={t.id}>
              <span className="song-number">{t.track || index + 1}</span>
              <div>
                <Link
                  className="song-title"
                  href={entityHref("songs", t.id, back)}
                >
                  {t.title}
                </Link>
                <div className="song-context">
                  <Link href={entityHref("artists", t.artist, back)}>
                    {t.artist}
                  </Link>
                  {view !== "albums" && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={entityHref("albums", t.albumKey, back)}>
                        {t.album}
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <details>
        <summary>Credits and library details</summary>
        <dl className="details-list">
          <div>
            <dt>Styles</dt>
            <dd>{entity.summary.styles.join(", ") || "Not set"}</dd>
          </div>
          <div>
            <dt>Moods</dt>
            <dd>{entity.summary.moods.join(", ") || "Not set"}</dd>
          </div>
          <div>
            <dt>Label</dt>
            <dd>{entity.summary.labels.join(", ") || "Not set"}</dd>
          </div>
        </dl>
        {view === "songs" && (
          <p className="muted small">File: {entity.tracks[0].path}</p>
        )}
      </details>
    </>
  );
}
