const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function albumHasConsistentIdentity(tags:Record<string,unknown>[]):boolean{
 if(!tags.length)return false;
 const all=new Set<string>();
 for(const tag of tags){
  const ids=new Set<string>();
  for(const source of [tag,tag.extraProperties])if(source&&typeof source==='object')for(const [key,value] of Object.entries(source)){
   if(key.replace(/[^a-z0-9]/gi,'').toLowerCase()!=='musicbrainzreleasegroupid')continue;
   for(const id of Array.isArray(value)?value:[value]){if(typeof id!=='string'||!uuid.test(id.trim()))return false;ids.add(id.trim().toLowerCase())}
  }
  if(ids.size!==1)return false;
  all.add([...ids][0]);
 }
 return all.size===1;
}
