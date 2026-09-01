import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const nativeOptions = { env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } };
const names: Record<string,string> = { TITLE:"title",ARTIST:"artist",ARTISTS:"artists",ALBUM:"album",ALBUMARTIST:"albumArtist",ALBUMARTISTS:"albumArtists",DATE:"date",YEAR:"year",TRACKNUMBER:"trackNumber",TRACKTOTAL:"totalTracks",TOTALTRACKS:"totalTracks",DISCNUMBER:"discNumber",DISCTOTAL:"totalDiscs",TOTALDISCS:"totalDiscs",GENRE:"genre",ISRC:"isrc",LABEL:"label",COMPOSER:"composer" };
export async function readNativeFlac(path:string):Promise<{tags:Record<string,unknown>;properties:Record<string,unknown>;pictures:unknown[]}>{
  const [{stdout:raw},{stdout:technical},{stdout:pictures}] = await Promise.all([
    run("metaflac",["--export-tags-to=-",path],{...nativeOptions,maxBuffer:2*1024*1024,timeout:120_000}),
    run("metaflac",["--show-total-samples","--show-sample-rate","--show-channels","--show-bps",path],{...nativeOptions,timeout:120_000}),
    run("metaflac",["--list","--block-type=PICTURE",path],{...nativeOptions,maxBuffer:256*1024,timeout:120_000}).catch(()=>({stdout:"",stderr:""})),
  ]);
  const tags:Record<string,unknown>={};
  for(const line of raw.split(/\r?\n/)){const at=line.indexOf("=");if(at<1)continue;const source=line.slice(0,at).toUpperCase(),key=names[source]??source,value=line.slice(at+1);const current=tags[key];tags[key]=current==null?[value]:[...(Array.isArray(current)?current:[current]),value]}
  const [totalSamples,sampleRate,channels,bitsPerSample]=technical.trim().split(/\s+/).map(Number);
  const pictureList=pictures.includes("type: 3 (Cover (front))")||pictures.includes("type: 0 (Other)")?[{type:"FrontCover"}]:[];
  return{tags,properties:{totalSamples,sampleRate,channels,bitsPerSample},pictures:pictureList};
}
