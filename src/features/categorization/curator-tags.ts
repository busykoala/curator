/**
 * Tags Curator writes itself. They must never be read back as evidence: doing so
 * lets earlier guesses reinforce themselves, and a tag rewrite would look like a
 * changed source and trigger needless reclassification.
 * LANGUAGE and MUSICALKEY are kept: Curator only preserves supplied values there.
 */
const owned=new Set([
  "genre","genres","style","styles","mood","moods","scene","scenes","era","styleera","groove","texture","timbre","production",
  "vocalprofile","instrumentation","lyricaltheme","listeningcontext","dynamiccharacter","structuralcharacter","recordingtype",
  "valence","energy","tempofeel","danceability","acousticelectroniccharacter","mode","meter","bpm",
  "artistdescription","albumdescription","trackdescription",
]);
const key=(name:string)=>name.toLowerCase().replace(/[^a-z]/g,"");
export function isCuratorOwnedTag(name:string){return owned.has(key(name))}
export function withoutCuratorTags<T extends Record<string,unknown>>(tags:T):T{
  const output:Record<string,unknown>={};
  for(const [name,value] of Object.entries(tags)){
    if(isCuratorOwnedTag(name))continue;
    if(name==="extraProperties"&&value&&typeof value==="object"&&!Array.isArray(value)){output[name]=withoutCuratorTags(value as Record<string,unknown>);continue}
    output[name]=value;
  }
  return output as T;
}
