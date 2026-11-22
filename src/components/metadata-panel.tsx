"use client";
import { useMemo } from "react";

type Percent = { label: string; percent: number | null };
export type TrackAnalysis = {
  heard: { styles: Percent[]; voice: number | null; danceable: number | null; moods: Record<string, number | null>; instruments: Percent[] } | null;
  derivation: { family: string; mainStyle: string | null; cluster: string; styles: string[]; confidence: number; audioBased: boolean; version: number } | null;
};
export type MetadataTrack = { id: number; title: string; path: string; status: string; tags: Record<string, unknown>; analysis?: TrackAnalysis };

/** Written tags, grouped as a listener thinks about them. Keys are matched case-insensitively. */
const GROUPS: Array<{ title: string; fields: Array<[string, string[]]> }> = [
  { title: "Genre", fields: [["Genre", ["genre"]], ["Style", ["style"]], ["Scene", ["scene"]], ["Era", ["era"]], ["Style era", ["styleera"]]] },
  { title: "Sound & feel", fields: [["Mood", ["mood"]], ["Energy", ["energy"]], ["Valence", ["valence"]], ["Danceability", ["danceability"]], ["Tempo feel", ["tempofeel"]], ["BPM", ["bpm"]], ["Key", ["musicalkey", "key", "initialkey"]], ["Mode", ["mode"]], ["Meter", ["meter"]], ["Groove", ["groove"]], ["Texture", ["texture"]], ["Timbre", ["timbre"]], ["Production", ["production"]], ["Acoustic / electronic", ["acousticelectroniccharacter"]], ["Dynamics", ["dynamiccharacter"]], ["Structure", ["structuralcharacter"]]] },
  { title: "Voice & instruments", fields: [["Vocals", ["vocalprofile"]], ["Instrumentation", ["instrumentation"]], ["Language", ["language"]]] },
  { title: "Listening", fields: [["Listening context", ["listeningcontext"]], ["Lyrical themes", ["lyricaltheme"]], ["Recording", ["recordingtype"]], ["Description", ["trackdescription"]]] },
  { title: "Identity", fields: [["Artist", ["artist"]], ["Album artist", ["albumartist"]], ["Album", ["album"]], ["Track", ["track", "tracknumber"]], ["Disc", ["disc", "discnumber"]], ["Date", ["date", "releasedate"]], ["Composer", ["composer"]], ["Label", ["label", "publisher"]], ["MusicBrainz release group", ["musicbrainzreleasegroupid"]], ["MusicBrainz artist", ["musicbrainzartistid"]], ["MusicBrainz recording", ["musicbrainztrackid"]]] },
];

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z]/g, "");
function tagValues(tags: Record<string, unknown>, keys: string[]): string[] {
  const flat: Record<string, unknown> = { ...tags, ...((tags.extraProperties as Record<string, unknown> | undefined) ?? {}) };
  const wanted = new Set(keys);
  const output: string[] = [];
  for (const [key, value] of Object.entries(flat)) {
    if (!wanted.has(normalizeKey(key))) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      const text = item == null ? "" : typeof item === "object" ? JSON.stringify(item) : String(item);
      if (text.trim() && !output.includes(text.trim())) output.push(text.trim());
    }
  }
  return output;
}

function Values({ values }: { values: string[] }) {
  if (!values.length) return <span className="muted">Not set</span>;
  return <span className="tag-row">{values.map((value) => <span className="filter-chip" key={value}>{value}</span>)}</span>;
}

function percentList(items: Percent[]) {
  return items.map((item) => `${item.label}${item.percent == null ? "" : ` ${item.percent}%`}`);
}

function SongAnalysis({ analysis }: { analysis?: TrackAnalysis }) {
  if (!analysis?.heard && !analysis?.derivation) return null;
  const { heard, derivation } = analysis;
  return (
    <details open>
      <summary>Audio analysis &amp; genre derivation</summary>
      <dl className="details-list">
        {derivation && (
          <>
            <div><dt>Derived genre</dt><dd><Values values={[derivation.family, derivation.mainStyle].filter((value): value is string => Boolean(value))} /></dd></div>
            <div><dt>Further styles</dt><dd><Values values={derivation.styles} /></dd></div>
            <div><dt>Listening cluster</dt><dd>{derivation.cluster}</dd></div>
            <div><dt>Evidence</dt><dd>{derivation.audioBased ? "Audio model, catalogue tags and AI profile" : "Catalogue tags and AI profile (audio analysis pending)"} · confidence {Math.round(derivation.confidence * 100)}%</dd></div>
          </>
        )}
        {heard && (
          <>
            <div><dt>Heard styles</dt><dd><Values values={percentList(heard.styles)} /></dd></div>
            <div><dt>Voice</dt><dd>{heard.voice == null ? "Unknown" : heard.voice >= 80 ? `Vocals (${heard.voice}%)` : heard.voice <= 15 ? `Instrumental (${100 - heard.voice}%)` : `Unclear (${heard.voice}% voice)`}</dd></div>
            <div><dt>Danceable</dt><dd>{heard.danceable == null ? "Unknown" : `${heard.danceable}%`}</dd></div>
            <div><dt>Heard moods</dt><dd><Values values={Object.entries(heard.moods).filter(([, value]) => value != null).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([mood, value]) => `${mood} ${value}%`)} /></dd></div>
            <div><dt>Heard instruments</dt><dd><Values values={percentList(heard.instruments)} /></dd></div>
          </>
        )}
      </dl>
    </details>
  );
}

/** Full tagging and analysis for one song, or every field's values with counts across an album. */
export function MetadataPanel({ view, tracks }: { view: string; tracks: MetadataTrack[] }) {
  const album = view !== "songs";
  const aggregated = useMemo(() => GROUPS.map((group) => ({
    title: group.title,
    fields: group.fields.map(([label, keys]) => {
      if (!album) return { label, values: tagValues(tracks[0]?.tags ?? {}, keys) };
      const counts = new Map<string, number>();
      for (const track of tracks) for (const value of tagValues(track.tags, keys)) counts.set(value, (counts.get(value) ?? 0) + 1);
      const values = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, count]) => (count === tracks.length || tracks.length === 1 ? value : `${value} ×${count}`));
      return { label, values };
    }),
  })), [album, tracks]);
  if (!tracks.length) return null;
  const skipForAlbum = new Set(["Track", "Description", "MusicBrainz recording"]);
  return (
    <section className="section">
      <div className="section-heading">
        <h2>Tags &amp; analysis</h2>
        <span className="muted">{album ? `Across ${tracks.length} songs` : "As written to the file"}</span>
      </div>
      {!album && <SongAnalysis analysis={tracks[0].analysis} />}
      {album && tracks.some((track) => track.analysis?.derivation) && (
        <p className="muted small">
          Derived genre: {[...new Set(tracks.map((track) => track.analysis?.derivation ? [track.analysis.derivation.family, track.analysis.derivation.mainStyle].filter(Boolean).join(" · ") : "").filter(Boolean))].join(" | ")}
          {" · "}audio analysis for {tracks.filter((track) => track.analysis?.heard).length} of {tracks.length} songs
        </p>
      )}
      {aggregated.map((group) => (
        <details key={group.title} open={group.title === "Genre" || group.title === "Sound & feel"}>
          <summary>{group.title}</summary>
          <dl className="details-list">
            {group.fields.filter((field) => !(album && skipForAlbum.has(field.label))).map((field) => (
              <div key={field.label}><dt>{field.label}</dt><dd><Values values={field.values} /></dd></div>
            ))}
          </dl>
        </details>
      ))}
      {!album && <p className="muted small">File: {tracks[0].path} · status {tracks[0].status}</p>}
    </section>
  );
}
