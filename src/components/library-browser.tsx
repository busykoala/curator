"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useListener } from "./app-shell";
import { ActionSheet } from "./action-sheet";
import { Artwork, Loading, Notice, PageHeader, entityHref } from "./ui";
import { readJson } from "./http";
type Item = {
  key: string;
  title: string;
  subtitle: string;
  count: number;
  year: string;
  artwork: string;
};
type Result = { items: Item[]; total: number; page: number; pageSize: number };
type Options = {
  genres: string[];
  years: string[];
  composers: string[];
  labels: string[];
};
const views = [
  ["albums", "Albums"],
  ["artists", "Artists"],
  ["songs", "Songs"],
];
export function LibraryBrowser() {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams(),
    view = [
      "albums",
      "artists",
      "songs",
      "composers",
      "years",
      "labels",
    ].includes(params.get("view") ?? "")
      ? params.get("view")!
      : "albums";
  const { user } = useListener();
  const restored = useRef("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(params.get("q") ?? ""),
    [result, setResult] = useState<Result>(),
    [error, setError] = useState(""),
    [filters, setFilters] = useState(false),
    [options, setOptions] = useState<Options>(),
    [optionsError, setOptionsError] = useState("");
  const key = params.toString(),
    page = Number(params.get("page")) || 1;
  useEffect(() => setQuery(params.get("q") ?? ""), [key]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setResult(undefined);
    const p = new URLSearchParams(key);
    p.set("view", view);
    void fetch("/api/library/browse?" + p, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => readJson<Result>(r))
      .then(setResult)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [key, view, retry]);
  useEffect(() => {
    if (!result || restored.current === key) return;
    restored.current = key;
    try {
      const saved = sessionStorage.getItem(
        `curator-library-scroll:${user.id}:${path}?${key}`,
      );
      if (saved !== null) {
        window.scrollTo(0, Number(saved));
        sessionStorage.removeItem(
          `curator-library-scroll:${user.id}:${path}?${key}`,
        );
      }
    } catch {}
  }, [result, key, user.id, path]);
  useEffect(() => {
    if (!filters || options) return;
    const controller = new AbortController();
    void fetch("/api/library/filters", { signal: controller.signal })
      .then((r) => readJson<Options>(r))
      .then(setOptions)
      .catch((e) => {
        if (!controller.signal.aborted) setOptionsError(e.message);
      });
    return () => controller.abort();
  }, [filters, options]);
  function url(p: URLSearchParams) {
    return path + (p.size ? "?" + p : "");
  }
  function change(name: string, value: string) {
    const p = new URLSearchParams(key);
    value ? p.set(name, value) : p.delete(name);
    if (name !== "page") p.delete("page");
    router.push(url(p), { scroll: false });
  }
  function search(event: FormEvent) {
    event.preventDefault();
    change("q", query.trim());
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget),
      p = new URLSearchParams(key);
    for (const name of ["genre", "year", "composer", "label"]) {
      const value = String(values.get(name) || "");
      value ? p.set(name, value) : p.delete(name);
    }
    p.delete("page");
    router.push(url(p), { scroll: false });
    setFilters(false);
  }
  const from = url(new URLSearchParams(key)),
    activeFilters = ["genre", "year", "composer", "label"].filter((name) =>
      params.get(name),
    );
  return (
    <div className="library-workspace">
      <PageHeader
        title="Library"
        actions={
          <Link className="secondary-button" href="/add">
            <Plus />
            Add music
          </Link>
        }
      />
      <nav className="view-tabs" aria-label="Library views">
        {views.map(([v, label]) => (
          <Link
            key={v}
            href={(() => {
              const p = new URLSearchParams(key);
              p.set("view", v);
              p.delete("page");
              return url(p);
            })()}
            scroll={false}
            className={view === v ? "selected" : ""}
            aria-current={view === v ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form className="library-searchbar" onSubmit={search}>
        <label className="library-search">
          <Search />
          <input
            type="search"
            aria-label="Search your library"
            placeholder="Search your library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="secondary-button" type="submit">
          Search
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Filter library"
          onClick={() => setFilters(true)}
        >
          <SlidersHorizontal />
        </button>
      </form>
      {activeFilters.length > 0 && (
        <div className="tag-row">
          {activeFilters.map((name) => (
            <button
              className="filter-chip"
              key={name}
              onClick={() => change(name, "")}
            >
              {params.get(name)}
              <X size={14} />
              <span className="sr-only">Clear {name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="library-toolbar">
        <span>
          {result
            ? `${result.total.toLocaleString()} ${view}`
            : "Updating library…"}
        </span>
        <label>
          Sort{" "}
          <select
            aria-label="Sort library"
            value={params.get("sort") ?? "name"}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="name">Name</option>
            <option value="recent">Recently updated</option>
          </select>
        </label>
      </div>
      {error ? (
        <Notice error>
          {error}
          <button
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Reload
          </button>
        </Notice>
      ) : !result ? (
        <Loading>Loading your collection…</Loading>
      ) : result.items.length ? (
        <div
          className={view === "albums" ? "media-grid" : "library-result-list"}
        >
          {result.items.map((item) => (
            <Link
              className={
                view === "albums" ? "media-card" : "library-result-row"
              }
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    `curator-library-scroll:${user.id}:${path}?${key}`,
                    String(window.scrollY),
                  );
                } catch {}
              }}
              href={entityHref(view, item.key, from)}
              key={item.key}
            >
              <Artwork src={item.artwork} />
              <span className="media-copy">
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
                {item.year && <small>{item.year}</small>}
              </span>
              {view !== "albums" && <ArrowRight />}
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>
            {params.get("q") || activeFilters.length
              ? "No matches"
              : "No music here yet"}
          </h2>
          <p>
            {params.get("q") || activeFilters.length
              ? "Try another search or clear your filters."
              : "Add an album to start your collection."}
          </p>
          <Link
            className="secondary-button"
            href={params.get("q") || activeFilters.length ? "/library" : "/add"}
          >
            {params.get("q") || activeFilters.length
              ? "Clear search and filters"
              : "Add music"}
          </Link>
        </div>
      )}
      {result && result.total > result.pageSize && (
        <nav className="pagination" aria-label="Result pages">
          <button
            className="secondary-button"
            disabled={page <= 1}
            onClick={() => change("page", String(page - 1))}
          >
            <ChevronLeft />
            Previous
          </button>
          <span>
            {page} / {Math.ceil(result.total / result.pageSize)}
          </span>
          <button
            className="secondary-button"
            disabled={page >= Math.ceil(result.total / result.pageSize)}
            onClick={() => change("page", String(page + 1))}
          >
            Next
            <ChevronRight />
          </button>
        </nav>
      )}
      <footer className="library-footer">
        <Link className="text-link" href="/requests">
          Your requests <ArrowRight />
        </Link>
        <Link className="text-link" href="/curator/review">
          Review metadata <ArrowRight />
        </Link>
      </footer>
      {filters && (
        <ActionSheet
          title="Filter your library"
          close={() => setFilters(false)}
        >
          {optionsError ? (
            <Notice error>{optionsError}</Notice>
          ) : !options ? (
            <Loading>Reading library filters…</Loading>
          ) : (
            <form onSubmit={applyFilters} className="form-stack">
              {[
                ["genre", "Genre", options.genres],
                ["year", "Year", options.years],
                ["composer", "Composer", options.composers],
                ["label", "Label", options.labels],
              ].map(([name, label, values]) => (
                <label key={String(name)}>
                  <span>{String(label)}</span>
                  <select
                    name={String(name)}
                    defaultValue={params.get(String(name)) ?? ""}
                  >
                    <option value="">Any {String(label).toLowerCase()}</option>
                    {(values as string[]).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="button-row">
                <button className="primary-button">Show results</button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    router.push("/library?view=" + view);
                    setFilters(false);
                  }}
                >
                  Clear filters
                </button>
              </div>
            </form>
          )}
        </ActionSheet>
      )}
    </div>
  );
}
