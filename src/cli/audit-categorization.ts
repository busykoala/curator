import Database from "better-sqlite3";
import { config,versions } from "@/config";
import { semanticProfileSchema } from "@/features/categorization/schema";

type ProfileRow={id:number;path:string;album_key:string;file_updated:string;status:string|null;profile_json:string|null;manual_json:string|null;provenance_json:string|null;schema_version:number|null;classifier_version:number|null;source_updated_at:string|null};
type Gate={name:string;ok:boolean;detail:string};
const database=new Database(config.DATABASE_PATH,{readonly:true,fileMustExist:true});
const one=(sql:string,...params:unknown[])=>Number((database.prepare(sql).get(...params) as{n:number}).n);
const rows=database.prepare(`SELECT f.id,f.path,f.album_key,f.updated_at file_updated,p.status,p.profile_json,p.manual_json,p.provenance_json,p.schema_version,p.classifier_version,p.source_updated_at FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id ORDER BY f.id`).all() as ProfileRow[];
const gates:Gate[]=[];
const add=(name:string,ok:boolean,detail:string)=>gates.push({name,ok,detail});
const parsed=rows.map(row=>{let profile:ReturnType<typeof semanticProfileSchema.parse>|null=null,manual:Record<string,unknown>={},audioAnalyzer=0;try{profile=semanticProfileSchema.parse(JSON.parse(row.profile_json??"null"))}catch{}try{manual=JSON.parse(row.manual_json??"{}") as Record<string,unknown>}catch{}try{audioAnalyzer=Number((JSON.parse(row.provenance_json??"{}") as{audioAnalyzer?:number}).audioAnalyzer??0)}catch{}const current=row.schema_version===versions.categorizationSchema&&row.classifier_version===versions.categorizationPrompt&&audioAnalyzer===versions.audioAnalysis&&Boolean(row.source_updated_at)&&String(row.source_updated_at)>=row.file_updated;return{row,profile,manual,current}});
const total=rows.length,current=parsed.filter(item=>item.current),complete=current.filter(item=>item.row.status==="complete"&&item.profile),partial=current.filter(item=>item.row.status==="partial"),failed=current.filter(item=>item.row.status==="failed"),pending=total-current.length;
add("inventory",total>0,`${total} indexed tracks`);
add("current profiles",pending===0,`${current.length}/${total} current; ${pending} pending or stale`);
add("complete profiles",complete.length===total,`${complete.length}/${total} complete; ${partial.length} partial; ${failed.length} failed`);

const optionalTypes=new Set(["intro","outro","interlude","skit","spoken_piece","field_recording"]);
const core=(profile:NonNullable<(typeof parsed)[number]["profile"]>)=>[profile.genre,profile.style,profile.mood,profile.groove,profile.texture,profile.timbre,profile.production,profile.listeningContexts,profile.vocalProfile.length?profile.vocalProfile:profile.instrumentation].filter(values=>values.length>0).length;
const sparse=complete.filter(({profile})=>profile&&!profile.recordingTypes.some(value=>optionalTypes.has(value))&&core(profile)<8);
add("rich normal tracks",sparse.length===0,`${complete.length-sparse.length}/${complete.length} meet the rich-profile floor; ${sparse.length} sparse`);

const audioCurrent=one("SELECT count(*) n FROM audio_features WHERE analyzer_version=?",versions.audioAnalysis);
add("current audio analysis",audioCurrent===total,`${audioCurrent}/${total} current analyzer-v${versions.audioAnalysis} feature sets`);

const albumTotal=one("SELECT count(DISTINCT album_key) n FROM files"),albumCurrent=one(`SELECT count(*) n FROM album_profiles a JOIN (SELECT album_key,count(*) tracks FROM files GROUP BY album_key) f ON f.album_key=a.album_key WHERE a.schema_version=? AND a.classifier_version=? AND json_valid(a.profile_json) AND json_extract(a.profile_json,'$.tracks')=f.tracks`,versions.categorizationSchema,versions.categorizationPrompt);
add("album aggregation",albumCurrent===albumTotal,`${albumCurrent}/${albumTotal} current complete album summaries`);

const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),overrideRows=parsed.filter(item=>Object.keys(item.manual).length>0),overrideMismatches=overrideRows.filter(({profile,manual})=>!profile||Object.entries(manual).some(([key,value])=>!equal(profile[key as keyof typeof profile],value)));
add("manual overrides",overrideMismatches.length===0,`${overrideRows.length} overrides checked; ${overrideMismatches.length} mismatches`);

const retryIssues=one("SELECT count(*) n FROM issues WHERE status='open' AND code IN ('categorization_pending','categorization_partial','categorization_failed','scan_failed')"),staleJobs=one("SELECT count(*) n FROM jobs WHERE status='running' AND coalesce(heartbeat_at,started_at,created_at)<datetime('now','-10 minutes')");
add("retry/error state",retryIssues===0,`${retryIssues} open categorization or scan issues`);
add("worker heartbeat",staleJobs===0,`${staleJobs} stale running jobs`);

const evidence=one("SELECT count(*) n FROM evidence"),providers=one("SELECT count(DISTINCT provider) n FROM evidence"),aiCache=one("SELECT count(*) n FROM enrichments");
add("shared source cache",evidence>0&&providers>0,`${evidence} cached evidence records from ${providers} providers`);
add("AI enrichment cache",aiCache>0,`${aiCache} cached album enrichments`);

const dimensions=["genre","style","mood","valence","energy","bpm","tempoFeel","groove","danceability","texture","timbre","production","acousticElectronicCharacter","vocalProfile","instrumentation","languages","lyricalThemes","listeningContexts","scenes","styleEra","musicalKey","mode","meter","dynamicCharacter","structuralCharacter","recordingTypes"] as const;
const coverage=Object.fromEntries(dimensions.map(field=>[field,complete.filter(({profile})=>{const value=profile?.[field];return Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!==""}).length]));
const report={ok:gates.every(gate=>gate.ok),versions:{schema:versions.categorizationSchema,classifier:versions.categorizationPrompt,audio:versions.audioAnalysis},tracks:{total,current:current.length,complete:complete.length,partial:partial.length,failed:failed.length,pending,sparse:sparse.length},albums:{total:albumTotal,current:albumCurrent},coverage,gates,examples:{pending:parsed.filter(item=>!item.current).slice(0,10).map(item=>item.row.path),sparse:sparse.slice(0,10).map(item=>item.row.path),overrideMismatches:overrideMismatches.slice(0,10).map(item=>item.row.path)}};
console.log(JSON.stringify(report,null,2));
database.close();
if(!report.ok)process.exitCode=1;
