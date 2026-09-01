"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  categoryOrder,
  getMeta,
  list,
  type PlaylistSuggestion,
} from "./playlist-view-model";

type Props = {
  suggestions: PlaylistSuggestion[];
  busy: boolean;
  create: (items: PlaylistSuggestion[]) => Promise<void>;
  customize: (item: PlaylistSuggestion) => void;
};

function identity(item: PlaylistSuggestion) {
  return item.name;
}

export function PlaylistOnboarding({
  suggestions,
  busy,
  create,
  customize,
}: Props) {
  const recommended = useMemo(
    () =>
      ["discovery", "mood", "rediscovery"]
        .map((category) => suggestions.find((item) => item.category === category))
        .filter((item): item is PlaylistSuggestion => Boolean(item)),
    [suggestions],
  );
  const [selected, setSelected] = useState(
    () => new Set(recommended.map(identity)),
  );
  const selectedItems = suggestions.filter((item) => selected.has(identity(item)));
  const more = suggestions.filter(
    (item) => !recommended.some((choice) => identity(choice) === identity(item)),
  );

  function toggle(item: PlaylistSuggestion) {
    const key = identity(item);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectionLabel = selectedItems.length
    ? selectedItems.length +
      " playlist" +
      (selectedItems.length === 1 ? "" : "s") +
      " selected"
    : "Choose at least one playlist";

  return (
    <section className="playlist-setup">
      <div className="setup-intro">
        <span className="kicker">Start with a small set</span>
        <h2>What should Curator make for you?</h2>
        <p>
          Pick one or more starting mixes. You can tune every choice before the
          first nightly refresh.
        </p>
      </div>

      <div className="starter-grid">
        {recommended.map((item) => {
          const meta = getMeta(item.category);
          const Icon = meta.icon;
          const active = selected.has(identity(item));
          const lanes = list(item.config.tasteLanes);
          return (
            <article
              className={"starter-card " + (active ? "selected" : "")}
              key={identity(item)}
            >
              <button
                className="starter-select"
                type="button"
                aria-pressed={active}
                onClick={() => toggle(item)}
              >
                <span className="starter-check">
                  {active ? <Check /> : <Icon />}
                </span>
                <span>
                  <small>{meta.shortLabel}</small>
                  <strong>{item.name}</strong>
                  <em>{item.intent || meta.description}</em>
                </span>
              </button>
              <div className="starter-foot">
                <span>
                  {Number(item.config.targetTracks ?? 30)} tracks
                  {lanes[0] ? " · " + lanes[0] : ""}
                </span>
                <button type="button" onClick={() => customize(item)}>
                  <SlidersHorizontal />
                  Customize
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {more.length > 0 && (
        <details className="more-playlist-ideas">
          <summary>
            <ChevronDown />
            Browse {more.length} more ideas
          </summary>
          <div>
            {categoryOrder.map((category) => {
              const options = more.filter((item) => item.category === category);
              if (!options.length) return null;
              const meta = getMeta(category);
              return (
                <section key={category}>
                  <h3>{meta.label}</h3>
                  {options.map((item) => (
                    <label key={identity(item)}>
                      <input
                        type="checkbox"
                        checked={selected.has(identity(item))}
                        onChange={() => toggle(item)}
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.intent || meta.description}</small>
                      </span>
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        </details>
      )}

      <footer className="setup-actionbar">
        <div>
          <strong>{selectionLabel}</strong>
          <span>Nothing changes in Navidrome until you confirm.</span>
        </div>
        <button
          className="primary-button"
          disabled={!selectedItems.length || busy}
          onClick={() => void create(selectedItems)}
        >
          <Sparkles />
          {busy
            ? "Creating…"
            : "Create " + (selectedItems.length || "") + " playlists"}
        </button>
      </footer>
    </section>
  );
}
