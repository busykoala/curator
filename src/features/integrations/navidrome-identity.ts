export const identityName=(value:string)=>value.normalize("NFKD").replace(/\p{M}+/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();

function strings(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):typeof value==="string"?[value]:[]}
function credits(value:string[]){
  return value.flatMap(item=>item.replace(/\b(?:feat(?:uring)?|ft)\.?\s+/gi,",").split(/[,;/&]/)).map(identityName).filter(Boolean).sort();
}
export function trackArtistMatches(actual:string[],primary:string,tagArtist:unknown){
  const actualName=identityName(actual.join(" "));
  const tagged=strings(tagArtist);
  const expected=[[primary],...(tagged.length?[tagged]:[])];
  return Boolean(actualName)&&expected.some(value=>actualName===identityName(value.join(" "))||JSON.stringify(credits(actual))===JSON.stringify(credits(value)));
}
export function trackAlbumMatches(actual:string,primary:string,tagAlbum:unknown){
  const name=identityName(actual);
  return Boolean(name)&&[primary,...strings(tagAlbum)].some(value=>identityName(value)===name);
}
