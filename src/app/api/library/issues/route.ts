import { authenticated } from "@/features/auth/session";
import { db } from "@/features/db/client";
import { reconcileIssues } from "@/features/analysis/reconcile";
import { versions } from "@/config";
const codes:Record<string,string[]>={"missing-artwork":["missing_embedded_art","missing_album_artwork","missing_artist_artwork"],identity:["identity_unresolved"],failed:["processing_failed","scan_failed","categorization_failed"],deferred:["processing_deferred"],metadata:["missing_albumArtist","missing_genre","missing_style","missing_mood","missing_scene","censored_metadata","categorization_pending","categorization_partial","categorization_failed"]};
const taxonomyFields=["genre","style","mood","scene"] as const;
type TaxonomyField=typeof taxonomyFields[number];
type AlbumCoverage={file_id:number;album_key:string;artist:string;album:string;tracks:number;updated_at:string;pending:number;partial:number;failed:number}&Record<`portable_${TaxonomyField}`|`semantic_${TaxonomyField}`,number>;
type IssueRow={id:number;album_key:string|null;code:string;severity:string;message:string;updated_at:string;artist:string|null;album:string|null;tracks:number};

function hasValue(paths:string[]):string{return paths.map(path=>`(coalesce(json_array_length(tags_json,'${path}'),0)>0 OR (json_type(tags_json,'${path}')='text' AND length(trim(json_extract(tags_json,'${path}')))>0))`).join(" OR ")}
function portable(field:TaxonomyField):string{
  const upper=field.toUpperCase(),paths=[`$.${field}`,`$.${upper}`,`$.extraProperties.${upper}`];
  if(field==="scene")paths.push("$.scenes","$.SCENES","$.extraProperties.SCENES");
  return `sum(CASE WHEN json_valid(tags_json) AND (${hasValue(paths)}) THEN 1 ELSE 0 END) portable_${field}`
}
function semantic(field:TaxonomyField):string{
  const key=field==="scene"?"scenes":field;
  return `sum(CASE WHEN semantic_state IN ('complete','partial') AND json_valid(profile_json) AND coalesce(json_array_length(profile_json,'$.${key}'),0)>0 THEN 1 ELSE 0 END) semantic_${field}`
}
function derived(id:number,row:AlbumCoverage,code:string,severity:string,message:string,tracks:number):IssueRow{return{id:-(row.file_id*100+id),album_key:row.album_key,code,severity,message,updated_at:row.updated_at,artist:row.artist,album:row.album,tracks}}
function taxonomyGaps():IssueRow[]{
  const columns=taxonomyFields.flatMap(field=>[portable(field),semantic(field)]).join(","),albums=db().prepare(`WITH current AS (SELECT f.*,p.profile_json,CASE WHEN p.file_id IS NULL OR p.schema_version<>? OR p.classifier_version<>? OR coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)<>? OR p.status='pending' OR (p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP) OR f.updated_at>p.source_updated_at THEN 'pending' ELSE p.status END semantic_state FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id) SELECT min(id) file_id,album_key,min(artist_name) artist,min(album_name) album,count(*) tracks,max(updated_at) updated_at,sum(semantic_state='pending') pending,sum(semantic_state='partial') partial,sum(semantic_state='failed') failed,${columns} FROM current GROUP BY album_key`).all(versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis) as AlbumCoverage[];
  return albums.flatMap(row=>{
    const issues:IssueRow[]=[];let id=1;
    if(row.failed)issues.push(derived(id++,row,"categorization_failed","error",`${row.failed} track${row.failed===1?"":"s"} failed current semantic categorization`,row.failed));
    if(row.partial)issues.push(derived(id++,row,"categorization_partial","warning",`${row.partial} track${row.partial===1?" has":"s have"} a sparse current semantic profile`,row.partial));
    if(row.pending)issues.push(derived(id++,row,"categorization_pending","info",`${row.pending} of ${row.tracks} tracks await the current semantic policy`,row.pending));
    for(const field of taxonomyFields){const portableMissing=row.tracks-row[`portable_${field}`],semanticMissing=row.tracks-row.pending-row.failed-row[`semantic_${field}`];if(!portableMissing&&!semanticMissing)continue;const label=field[0].toUpperCase()+field.slice(1),parts=[];if(portableMissing)parts.push(`${portableMissing} track${portableMissing===1?" lacks":"s lack"} the portable ${field.toUpperCase()} tag`);if(semanticMissing>0)parts.push(`${semanticMissing} categorized track${semanticMissing===1?" lacks":"s lack"} semantic ${field}`);issues.push(derived(id++,row,`missing_${field}`,field==="scene"?"info":"warning",`${label}: ${parts.join("; ")}`,Math.max(portableMissing,semanticMissing)))}
    return issues;
  })
}
export async function GET(request:Request){
  if(!await authenticated())return new Response("Unauthorized",{status:401});reconcileIssues();const url=new URL(request.url),filter=url.searchParams.get("filter")??"all",limit=Math.min(5000,Math.max(1,Number(url.searchParams.get("limit")??5000))),selected=codes[filter],base=`SELECT min(i.id) id,i.album_key,i.code,max(i.severity) severity,max(i.message) message,max(i.updated_at) updated_at,(SELECT min(artist_name) FROM files WHERE album_key=i.album_key) artist,(SELECT min(album_name) FROM files WHERE album_key=i.album_key) album,count(DISTINCT i.file_id) tracks FROM issues i WHERE i.status='open'`;
  const grouped=" GROUP BY i.code,coalesce(i.album_key,'issue:'||i.id)",stored=filter==="duplicates"?[]:selected?.length?db().prepare(`${base} AND i.code IN (${selected.map(()=>"?").join(",")})${grouped}`).all(...selected) as IssueRow[]:db().prepare(`${base}${grouped}`).all() as IssueRow[],derived=filter==="metadata"?taxonomyGaps():[],merged=new Map<string,IssueRow>();for(const issue of [...stored,...derived])merged.set(`${issue.code}:${issue.album_key??issue.id}`,issue);const rank:Record<string,number>={error:0,warning:1,info:2},allIssues=[...merged.values()].sort((a,b)=>(rank[a.severity]??3)-(rank[b.severity]??3)||b.updated_at.localeCompare(a.updated_at)),issueCounts=Object.fromEntries([...new Set(allIssues.map(issue=>issue.code))].map(code=>[code,allIssues.filter(issue=>issue.code===code).length])),issues=allIssues.slice(0,limit),duplicates=filter==="all"||filter==="duplicates"?db().prepare("SELECT group_key,artist,album,kind,confidence,status,detail_json,updated_at FROM duplicate_groups WHERE status IN ('open','blocked') ORDER BY status,confidence DESC LIMIT ?").all(limit):[];return Response.json({filter,issues,issueCounts,total:allIssues.length,duplicates})
}
