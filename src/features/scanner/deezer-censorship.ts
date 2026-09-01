import { basename, extname, relative } from "node:path";

const CENSOR_MARKER = /#{2,}/;
const RELEASE_YEAR = /\s+\(\d{4}\)$/;
const TRACK_PREFIX = / - \d{1,3} - (.+)$/;
const knownRepairs = new Map([
  ["Fran##oise", "Françoise"], ["M##s", "Más"], ["#####lectronique", "Électronique"],
]);

type PortableTags = Record<string, unknown>;

function text(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : "";
}

function replaceCensored(value: unknown, fallback: string | undefined): unknown {
  const current = text(value);
  if (!fallback || !CENSOR_MARKER.test(current) || CENSOR_MARKER.test(fallback)) return value;
  if (!Array.isArray(value)) return fallback;
  return [fallback, ...value.slice(1).filter((item) => item !== current)];
}

export function repairDamagedText(value: string): string {
  let output=value;
  for(const[from,to]of knownRepairs)output=output.replaceAll(from,to);
  return output
    .replace(/###([^#]*?)###(\d{2})([^#]*?)###/g,'"$1\'$2$3"')
    .replace(/(\p{L})###([sStTmMdDvVrReEll])\b/gu,"$1'$2")
    .replace(/###([^#\n]+?)###/g,'"$1"')
    .replace(/###(?=\d)/g,"'")
    .replace(/###/g,'"');
}

function repairDescription(value:unknown,fallback:string):unknown{
  const current=text(value),repaired=repairDamagedText(current);
  const safe=CENSOR_MARKER.test(repaired)||repaired.includes("�")?fallback:repaired;
  if(!Array.isArray(value))return safe;
  return[safe,...value.slice(1)];
}

function pathHints(path: string, musicRoot: string): {
  artist?: string;
  album?: string;
  title?: string;
} {
  const parts = relative(musicRoot, path).split("/");
  const file = basename(path, extname(path));
  return {
    artist: parts.length >= 2 ? parts[0] : undefined,
    album: parts.length >= 3 ? parts[1].replace(RELEASE_YEAR, "") : undefined,
    title: file.match(TRACK_PREFIX)?.[1],
  };
}

export function repairDeezerCensorship(
  path: string,
  tags: PortableTags,
  musicRoot: string,
): PortableTags {
  const hints = pathHints(path, musicRoot);
  const repaired:PortableTags = {
    ...tags,
    title: replaceCensored(tags.title, hints.title),
    album: replaceCensored(tags.album, hints.album),
    artist: replaceCensored(tags.artist, hints.artist),
    albumArtist: replaceCensored(tags.albumArtist, hints.artist),
  };
  const artist=text(repaired.artist)||hints.artist||"Unknown Artist",album=text(repaired.album)||hints.album||"Unknown Album";
  repaired.ARTISTDESCRIPTION=repairDescription(tags.ARTISTDESCRIPTION,`${artist} is the credited artist for ${album}.`);
  repaired.ALBUMDESCRIPTION=repairDescription(tags.ALBUMDESCRIPTION,`${album} is an album by ${artist}.`);
  const extra=tags.extraProperties;if(extra&&typeof extra==="object")repaired.extraProperties={...extra,ARTISTDESCRIPTION:repaired.ARTISTDESCRIPTION,ALBUMDESCRIPTION:repaired.ALBUMDESCRIPTION};
  return repaired;
}
