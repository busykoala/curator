"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, LoaderCircle, Save, X } from "lucide-react";
import { EnergyShape } from "./energy-shape";
import {
  TagCombobox,
  type ComboOption,
} from "./tag-combobox";
import {
  getMeta,
  list,
  type PlaylistDefinition,
} from "./playlist-view-model";

type Props = {
  initial: PlaylistDefinition;
  users: Array<{id:number;displayName:string;tokenStatus:string}>;
  close: () => void;
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

function copy(
  value: PlaylistDefinition,
  key: string,
  next: unknown,
): PlaylistDefinition {
  return {
    ...value,
    config: { ...value.config, [key]: next },
  };
}

export function PlaylistEditor({ initial, users, close, save }: Props) {
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [value, setValue] = useState(initial);
  const config = value.config;
  const meta = getMeta(value.category);
  const title = value.id
    ? "Edit " + value.name
    : value.category === "mood"
      ? "Add a mood or occasion"
      : value.category === "discovery"
        ? "Add a discovery lane"
        : "Build a progressive journey";

  useEffect(() => {
    let active = true;
    fetch("/api/playlists/options")
      .then((response) => response.json())
      .then((result) => {
        if (active) setOptions({ ...emptyOptions, ...result });
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&window.confirm("Close without saving these playlist changes?"))close()};window.addEventListener("keydown",escape);return()=>window.removeEventListener("keydown",escape)},[close]);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await save(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <form className="playlist-editor playlist-editor-v2 intent-editor" role="dialog" aria-modal="true" aria-labelledby="playlist-editor-title" onSubmit={submit}>
        <header>
          <div>
            <span className="intent-category">{meta.label}</span>
            <h2 id="playlist-editor-title">{title}</h2>
            <p>{meta.description}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close playlist editor" onClick={close}>
            <X />
          </button>
        </header>

        <div className="playlist-editor-body">
          {loadingOptions && (
            <div className="options-loading">
              <LoaderCircle className="spin" />
              Reading your library vocabulary…
            </div>
          )}

          <div className="playlist-essentials">
            <label><span>Playlist owner</span><select value={value.ownerUserId} onChange={event=>setValue({...value,ownerUserId:Number(event.target.value)})}>{users.map(user=><option key={user.id} value={user.id}>{user.displayName}{user.tokenStatus!=="active"?" · sign-in required":""}</option>)}</select><small>Any Curator user may assign this playlist to any provisioned listener.</small></label>
            <label>
              <span>Playlist name</span>
              <input
                required
                value={value.name}
                placeholder={
                  value.category === "mood"
                    ? "Sunday morning"
                    : value.category === "discovery"
                      ? "New alternative soul"
                      : "A slow electronic ascent"
                }
                onChange={(event) =>
                  setValue({ ...value, name: event.target.value })
                }
              />
            </label>

            {value.category === "mood" && (
              <>
                <TagCombobox
                  label="Moods"
                  hint="Choose from moods already found in your library, or type your own."
                  placeholder="Search reflective, warm, serene…"
                  values={list(config.moods)}
                  options={options.moods}
                  change={(next) => setValue(copy(value, "moods", next))}
                />
                <TagCombobox
                  label="Occasions"
                  hint="Where or when should this playlist work?"
                  placeholder="Search focus, dinner, late night…"
                  values={list(config.contexts)}
                  options={options.contexts}
                  change={(next) => setValue(copy(value, "contexts", next))}
                />
                <TagCombobox
                  label="Sound palette"
                  hint="Optional genres, styles, textures, or timbres."
                  placeholder="Search jazz, mellow, acoustic, smooth…"
                  values={list(config.tasteLanes)}
                  options={directionOptions}
                  change={(next) => setValue(copy(value, "tasteLanes", next))}
                />
              </>
            )}

            {(value.category === "discovery" ||
              value.category === "journey") && (
              <TagCombobox
                label="Genre, subgenre, or theme"
                hint="Suggestions come from your actual tags and technical profiles."
                placeholder={
                  value.category === "discovery"
                    ? "Search melodic techno, future jazz…"
                    : "Search rock, uplifting, crescendo…"
                }
                values={list(config.tasteLanes)}
                options={directionOptions}
                change={(next) => setValue(copy(value, "tasteLanes", next))}
              />
            )}

            <label>
              <span>
                {value.category === "mood"
                  ? "Extra guidance"
                  : value.category === "discovery"
                    ? "What should Curator look for?"
                    : "Describe the musical progression"}
              </span>
              <textarea
                value={value.intent}
                placeholder={
                  value.category === "journey"
                    ? "Begin with restraint, become energizing, reach one clear peak, then settle."
                    : "Optional boundaries, exclusions, or atmosphere."
                }
                onChange={(event) =>
                  setValue({ ...value, intent: event.target.value })
                }
              />
            </label>
          </div>

          {value.category === "journey" && (
            <EnergyShape
              value={String(config.energyCurve ?? "slow_burn") as "slow_burn" | "ascent" | "wave" | "descent"}
              change={(next) => setValue(copy(value, "energyCurve", next))}
            />
          )}

          <section className="mix-controls">
            <label>
              <span>
                Length <strong>{Number(config.targetTracks ?? 30)} tracks</strong>
              </span>
              <input
                type="range"
                min="8"
                max="80"
                value={Number(config.targetTracks ?? 30)}
                onChange={(event) =>
                  setValue(
                    copy(value, "targetTracks", Number(event.target.value)),
                  )
                }
              />
            </label>
            <label>
              <span>
                Change nightly{" "}
                <strong>{Number(config.rotationPercent ?? 30)}%</strong>
              </span>
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                value={Number(config.rotationPercent ?? 30)}
                onChange={(event) =>
                  setValue(
                    copy(value, "rotationPercent", Number(event.target.value)),
                  )
                }
              />
              <small>30% balances familiarity and variety.</small>
            </label>
            <label>
              <span>Adventure <strong>{Number(config.explorationPercent ?? 35)}%</strong></span>
              <input type="range" min="0" max="100" step="5" value={Number(config.explorationPercent ?? 35)} onChange={event=>setValue(copy(value,"explorationPercent",Number(event.target.value)))}/>
              <small>Higher values favor less familiar parts of the library.</small>
            </label>
          </section>

          <TagCombobox
            label="Exclude"
            hint="Search artists, albums, genres, or styles. Custom exclusions are accepted."
            placeholder="Search your library…"
            values={list(config.exclusions)}
            options={options.exclusions}
            change={(next) => setValue(copy(value, "exclusions", next))}
          />

          <details className="playlist-advanced">
            <summary>
              <ChevronDown />
              Advanced limits
            </summary>
            <div>
              <label>
                <span>Tracks per artist</span>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={Number(config.maxTracksPerArtist ?? 2)}
                  onChange={(event) =>
                    setValue(
                      copy(
                        value,
                        "maxTracksPerArtist",
                        Number(event.target.value),
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span>Tracks per album</span>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={Number(config.maxTracksPerAlbum ?? 1)}
                  onChange={(event) =>
                    setValue(
                      copy(
                        value,
                        "maxTracksPerAlbum",
                        Number(event.target.value),
                      ),
                    )
                  }
                />
              </label>
              {value.category === "discovery" && (
                <label>
                  <span>Preferred publications</span>
                  <input
                    value={list(config.sourceDomains).join(", ")}
                    placeholder="bandcamp.com, thequietus.com"
                    onChange={(event) =>
                      setValue(
                        copy(
                          value,
                          "sourceDomains",
                          event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        ),
                      )
                    }
                  />
                </label>
              )}
            </div>
          </details>

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
              <small>Curator reconciles it at 04:30 Europe/Zurich.</small>
            </span>
          </label>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            <Save />
            {busy ? "Saving…" : value.id ? "Save changes" : "Create playlist"}
          </button>
        </footer>
      </form>
    </div>
  );
}
