"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Save, Sparkles, X } from "lucide-react";
import { EnergyShape } from "./energy-shape";
import { TagCombobox, type ComboOption } from "./tag-combobox";
import { useListener } from "./app-shell";
import { readJson } from "./http";
import {
  getMeta,
  list,
  type PlaylistDefinition,
  type PlaylistSuggestion,
} from "./playlist-view-model";

type Props = {
  initial: PlaylistDefinition;
  close: () => void;
  page?: boolean;
  save: (value: PlaylistDefinition) => Promise<void>;
};

type Options = {
  genres: ComboOption[];
  styles: ComboOption[];
  moods: ComboOption[];
  contexts: ComboOption[];
  scenes: ComboOption[];
  themes: ComboOption[];
  technical: ComboOption[];
  exclusions: ComboOption[];
};

const emptyOptions: Options = {
  genres: [],
  styles: [],
  moods: [],
  contexts: [],
  scenes: [],
  themes: [],
  technical: [],
  exclusions: [],
};

const directionCopy: Record<
  string,
  { label: string; hint: string; placeholder: string; name: string }
> = {
  rediscovery: {
    label: "Genre or style to rediscover",
    hint: "Optional. Leave empty to revisit favorites across your collection.",
    placeholder: "Search jazz, rock, soul…",
    name: "Forgotten jazz favorites",
  },
  depth: {
    label: "Part of your collection to explore",
    hint: "Optional genres, styles, or themes. Leave empty to explore the whole collection.",
    placeholder: "Search alternative rock, ambient, acoustic…",
    name: "Deeper into alternative rock",
  },
  discovery: {
    label: "Genre, style, or theme",
    hint: "Choose the direction for new releases and your library mix.",
    placeholder: "Search melodic techno, future jazz…",
    name: "New alternative soul",
  },
  journey: {
    label: "Sound of the journey",
    hint: "Choose genres, styles, or textures; the energy shape controls their progression.",
    placeholder: "Search rock, electronic, cinematic…",
    name: "A slow electronic ascent",
  },
};

export function PlaylistEditor({ initial, close, save, page = false }: Props) {
  const { user } = useListener();
  const draftKey = `curator-playlist-draft:${user.id}:${initial.id ?? initial.category}`;
  const [draftReady, setDraftReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [ideas, setIdeas] = useState<PlaylistSuggestion[]>();
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState("");
  const [error, setError] = useState("");
  const [value, setValue] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const config = value.config;
  const meta = getMeta(value.category);
  const direction = directionCopy[value.category];

  useEffect(() => {
    const controller = new AbortController();
    // Library vocabulary is optional: a custom direction still works if it fails.
    void (async () => {
      try {
        const result = await readJson<Options>(
          await fetch("/api/playlists/options", { signal: controller.signal }),
          "Library options could not be loaded",
        );
        if (!controller.signal.aborted)
          setOptions({ ...emptyOptions, ...result });
      } catch {
        if (!controller.signal.aborted)
          setOptionsError(
            "Library suggestions are unavailable. You can still type your own terms.",
          );
      } finally {
        if (!controller.signal.aborted) setLoadingOptions(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (
        draft &&
        draft.category === initial.category &&
        draft.ownerUserId === user.id &&
        draft.id === initial.id
      )
        setValue(draft);
    } catch {}
    setDraftReady(true);
  }, [draftKey, initial.category, initial.id, user.id]);
  useEffect(() => {
    if (draftReady) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(value));
      } catch {}
    }
  }, [value, draftReady, draftKey]);

  useEffect(() => {
    if (page && window.matchMedia("(max-width: 700px)").matches) return;
    const previous = document.activeElement as HTMLElement | null;
    form.current
      ?.querySelector<HTMLInputElement>("input[name=playlistName]")
      ?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!page && event.key === "Tab") {
        const controls = [
          ...(form.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
          ) ?? []),
        ].filter((node) => node.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (
        target.getAttribute("role") === "combobox" &&
        target.getAttribute("aria-expanded") === "true"
      )
        return;
      if (!busy) close();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [close, busy, page]);

  const directionOptions = useMemo(
    () => [
      ...options.genres,
      ...options.styles,
      ...options.scenes,
      ...options.themes,
      ...options.technical,
    ],
    [options],
  );

  function setting(key: string, next: unknown) {
    setValue((current) => ({
      ...current,
      config: { ...current.config, [key]: next },
    }));
  }

  function changeDirection(next: string[]) {
    // Older presets stored the same direction twice. Show both fields and clear
    // the legacy one on edit so removing a chip really removes that filter.
    setValue((current) => ({
      ...current,
      config: { ...current.config, tasteLanes: next, genres: [] },
    }));
  }

  async function loadIdeas() {
    if (loadingIdeas || ideas) return;
    setLoadingIdeas(true);
    setIdeasError("");
    try {
      const result = await readJson<{ suggestions: PlaylistSuggestion[] }>(
        await fetch("/api/playlists/suggestions", { cache: "no-store" }),
        "Starting ideas could not be loaded",
      );
      setIdeas(
        result.suggestions.filter((item) => item.category === initial.category),
      );
    } catch {
      setIdeasError(
        "Starting ideas are unavailable. You can create your own direction below.",
      );
    } finally {
      setLoadingIdeas(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(value);
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Playlist could not be saved. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={page ? "playlist-form-page" : "drawer-backdrop"}
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && close()
      }
    >
      <form
        ref={form}
        className={"playlist-editor intent-editor" + (page ? " is-page" : "")}
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="playlist-editor-title"
        onSubmit={submit}
      >
        {!page && (
          <header>
            <div>
              <span className="intent-category">{meta.label}</span>
              <h2 id="playlist-editor-title">
                {value.id
                  ? "Edit playlist"
                  : "Create " + meta.label.toLowerCase()}
              </h2>
              <p>{meta.description}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close playlist editor"
              disabled={busy}
              onClick={close}
            >
              <X />
            </button>
          </header>
        )}

        <div className="playlist-editor-body">
          {!initial.id && (
            <details
              className="playlist-starting-ideas"
              onToggle={(event) => event.currentTarget.open && void loadIdeas()}
            >
              <summary>
                <Sparkles />
                Start from an idea
                <ChevronDown />
              </summary>
              <p>
                Choose an optional starting point, then adjust it before
                creating your playlist.
              </p>
              {loadingIdeas && (
                <p role="status">
                  <LoaderCircle className="spin" />
                  Finding ideas from your listening…
                </p>
              )}
              {ideasError && (
                <p role="status">
                  {ideasError}{" "}
                  <button type="button" onClick={() => void loadIdeas()}>
                    Retry
                  </button>
                </p>
              )}
              {ideas && !ideas.length && (
                <p>
                  Ideas for this type will appear as Curator learns from your
                  listening.
                </p>
              )}
              <div>
                {ideas?.map((idea) => (
                  <button
                    type="button"
                    key={idea.key}
                    onClick={() =>
                      setValue((current) => ({
                        ...current,
                        name: idea.name,
                        intent: idea.intent,
                        config: { ...current.config, ...idea.config },
                      }))
                    }
                  >
                    {idea.name}
                  </button>
                ))}
              </div>
            </details>
          )}

          {loadingOptions && (
            <div className="options-loading" role="status">
              <LoaderCircle className="spin" />
              Reading your library vocabulary…
            </div>
          )}
          {optionsError && (
            <p className="playlist-editor-note" role="status">
              {optionsError}
            </p>
          )}

          <div className="playlist-essentials">
            <label>
              <span>Playlist name</span>
              <input
                name="playlistName"
                required
                minLength={2}
                maxLength={100}
                value={value.name}
                placeholder={direction?.name ?? "Sunday morning"}
                onChange={(event) =>
                  setValue({ ...value, name: event.target.value })
                }
              />
            </label>
            {value.category === "mood" ? (
              <>
                <TagCombobox
                  label="Moods"
                  hint="How should the music feel?"
                  placeholder="Search reflective, warm, serene…"
                  values={list(config.moods)}
                  options={options.moods}
                  change={(next) => setting("moods", next)}
                />
                <TagCombobox
                  label="Occasions"
                  hint="Where or when should this playlist work?"
                  placeholder="Search focus, dinner, late night…"
                  values={list(config.contexts)}
                  options={options.contexts}
                  change={(next) => setting("contexts", next)}
                />
                <TagCombobox
                  label="Sound palette"
                  hint="Optional genres, styles, textures, or instruments."
                  placeholder="Search jazz, mellow, acoustic…"
                  values={[
                    ...new Set([
                      ...list(config.tasteLanes),
                      ...list(config.genres),
                    ]),
                  ]}
                  options={directionOptions}
                  change={changeDirection}
                />
              </>
            ) : (
              direction && (
                <TagCombobox
                  label={direction.label}
                  hint={direction.hint}
                  placeholder={direction.placeholder}
                  values={[
                    ...new Set([
                      ...list(config.tasteLanes),
                      ...list(config.genres),
                    ]),
                  ]}
                  options={directionOptions}
                  change={changeDirection}
                />
              )
            )}

            {value.category === "rediscovery" && (
              <label>
                <span>
                  Not played in the last{" "}
                  <strong>{Number(config.noveltyDays ?? 30)} days</strong>
                </span>
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={Number(config.noveltyDays ?? 30)}
                  onChange={(event) =>
                    setting("noveltyDays", Number(event.target.value))
                  }
                />
                <small>
                  Revisit rated or starred favorites and albums from your
                  listening history. Recently played albums stay out.
                </small>
              </label>
            )}

            {value.category === "discovery" && (
              <label>
                <span>
                  Research brief <small>optional</small>
                </span>
                <textarea
                  maxLength={1000}
                  value={value.intent}
                  placeholder="What should Curator look for in new releases?"
                  onChange={(event) =>
                    setValue({ ...value, intent: event.target.value })
                  }
                />
                <small>
                  Guides research into recent releases. The direction above
                  controls which library songs fit.
                </small>
              </label>
            )}
          </div>

          {value.category === "journey" && (
            <EnergyShape
              value={config.energyCurve ?? "slow_burn"}
              change={(next) => setting("energyCurve", next)}
            />
          )}

          <section
            className="mix-controls"
            aria-label="Playlist size and refresh"
          >
            <label>
              <span>Number of songs</span>
              <input
                aria-label="Number of songs"
                type="number"
                min={1}
                max={100}
                value={Number(config.targetTracks ?? 30)}
                onChange={(event) =>
                  setting("targetTracks", Number(event.target.value))
                }
              />
              <small>Curator uses songs available in your library.</small>
            </label>
          </section>

          <label className="enable-row">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) =>
                setValue({ ...value, enabled: event.target.checked })
              }
            />
            <span>
              <strong>Refresh this playlist nightly</strong>
              <small>
                {value.enabled
                  ? "Refreshes at 04:30 Europe/Zurich. You can also refresh it yourself."
                  : "Refresh it yourself whenever you want a new mix."}
              </small>
            </span>
          </label>

          <details className="playlist-advanced">
            <summary>
              <ChevronDown />
              Fine-tune the mix
            </summary>
            <div>
              <label>
                <span>
                  Refresh variation{" "}
                  <strong>{Number(config.rotationPercent ?? 30)}%</strong>
                </span>
                <input
                  aria-label="Refresh variation"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number(config.rotationPercent ?? 30)}
                  onChange={(event) =>
                    setting("rotationPercent", Number(event.target.value))
                  }
                />
                <small>
                  Aim to replace this share of songs whenever you refresh,
                  manually or nightly.
                </small>
              </label>
              {value.category !== "rediscovery" && (
                <label className="playlist-wide-field">
                  <span>
                    Favor familiar music{" "}
                    <strong>
                      {100 - Number(config.explorationPercent ?? 35)}%
                    </strong>
                  </span>
                  <input
                    aria-label="Favor familiar music"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={100 - Number(config.explorationPercent ?? 35)}
                    onChange={(event) =>
                      setting(
                        "explorationPercent",
                        100 - Number(event.target.value),
                      )
                    }
                  />
                  <small>
                    How much your listening history influences the selection.
                  </small>
                </label>
              )}
              <label>
                <span>Maximum songs per artist</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={Number(config.maxTracksPerArtist ?? 2)}
                  onChange={(event) =>
                    setting("maxTracksPerArtist", Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>Maximum songs per album</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={Number(config.maxTracksPerAlbum ?? 1)}
                  onChange={(event) =>
                    setting("maxTracksPerAlbum", Number(event.target.value))
                  }
                />
              </label>
              {value.category !== "mood" && (
                <>
                  <div className="playlist-wide-field">
                    <TagCombobox
                      label="Mood filters"
                      placeholder="Search moods…"
                      values={list(config.moods)}
                      options={options.moods}
                      change={(next) => setting("moods", next)}
                    />
                  </div>
                  <div className="playlist-wide-field">
                    <TagCombobox
                      label="Occasion filters"
                      placeholder="Search occasions…"
                      values={list(config.contexts)}
                      options={options.contexts}
                      change={(next) => setting("contexts", next)}
                    />
                  </div>
                </>
              )}
              <div className="playlist-wide-field">
                <TagCombobox
                  label="Exclude"
                  hint="Artists, albums, genres, or styles to leave out."
                  placeholder="Search your library…"
                  values={list(config.exclusions)}
                  options={options.exclusions}
                  change={(next) => setting("exclusions", next)}
                />
              </div>
              {value.category === "discovery" && (
                <label className="playlist-wide-field">
                  <span>Preferred publications</span>
                  <input
                    value={list(config.sourceDomains).join(", ")}
                    placeholder="bandcamp.com, thequietus.com"
                    onChange={(event) =>
                      setting(
                        "sourceDomains",
                        event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                  <small>
                    Suggestions for the release research, separated by commas.
                    Research runs on Tuesday and Friday.
                  </small>
                </label>
              )}
            </div>
          </details>
          {error && (
            <p className="playlist-editor-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            <Save />
            {busy ? "Saving…" : value.id ? "Save changes" : "Create & preview"}
          </button>
        </footer>
      </form>
    </div>
  );
}
