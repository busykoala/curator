// Keep the database view in step with the tags we actually write. In particular,
// leaving old MusicBrainz IDs in extraProperties made repaired files appear
// unresolved (or appear to retain an earlier identity) until the next scan.
const fields:Record<string,string>={TITLE:'title',ARTIST:'artist',ARTISTS:'artists',ALBUM:'album',ALBUMARTIST:'albumArtist',ALBUMARTISTS:'albumArtists',GENRE:'genre',COMPOSER:'composer',AUTHOR:'AUTHOR',STYLE:'style',MOOD:'mood',SCENE:'scene',ERA:'era',DATE:'date',MUSICBRAINZ_ARTISTID:'musicbrainzArtistId',MUSICBRAINZ_ALBUMARTISTID:'musicbrainzReleaseArtistId',MUSICBRAINZ_RELEASEGROUPID:'musicbrainzReleaseGroupId',MUSICBRAINZ_ALBUMID:'musicbrainzReleaseId',MUSICBRAINZ_TRACKID:'musicbrainzTrackId'};
const basic=new Set(['TITLE','ARTIST','ALBUM','ALBUMARTIST','GENRE','COMPOSER','DATE']);
const normalized=(key:string)=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
export function tagSnapshot(source:string|undefined,properties:Record<string,string[]>):string{
 const tags=source?JSON.parse(source) as Record<string,unknown>:{},extra={...(tags.extraProperties as Record<string,unknown>|undefined)};
 for(const [property,values] of Object.entries(properties)){
  const key=property.toUpperCase(),field=fields[key]??key,list=values.filter(Boolean);
  // Scans can produce both typed and raw property names. Replace every alias
  // of a written property, while preserving fields outside this write.
  for(const alias of Object.keys(tags))if(alias!==field&&normalized(alias)===normalized(key))delete tags[alias];
  for(const alias of Object.keys(extra))if(normalized(alias)===normalized(key))delete extra[alias];
  if(list.length){tags[field]=list.length===1?list[0]:list;if(!basic.has(key))extra[key]=list}
  else delete tags[field];
  if(key==='DATE'){const year=Number(list[0]?.slice(0,4));if(Number.isInteger(year)&&year>0)tags.year=year;else delete tags.year}
 }
 if(Object.keys(extra).length)tags.extraProperties=extra;else delete tags.extraProperties;
 return JSON.stringify(tags);
}
