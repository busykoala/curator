// Extract the unchanged selection/ordering functions from the deployed commit.
// Replace database reads only with supplied, controlled fixture inputs. This
// keeps the comparison independent of the new implementation's scoring rules.
const {execFileSync}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {resolve}=require('node:path');
const esbuild=require('esbuild');
async function main(){
  const revision='4177f1d',get=path=>execFileSync('git',['show',revision+':'+path],{encoding:'utf8'}),generate=get('src/features/playlists/generate.ts'),scorer=get('src/features/playlists/candidate-score.ts'),sequence=get('src/features/playlists/sequence.ts');
  if(readFileSync('src/features/playlists/candidate-score.ts','utf8')!==scorer)throw Error('Legacy scorer changed; import its frozen source explicitly');
  const begin=generate.indexOf('function select('),end=generate.indexOf('export async function generatePlaylist(',begin);
  if(begin<0||end<0)throw Error('Cannot locate the baseline selector');
  const prefix='/private/tmp/curator-playlist-baseline';
  writeFileSync(prefix+'-sequence.ts',sequence);
  const text=`import {createHash} from 'node:crypto';
import {sequenceJourney} from ${JSON.stringify(prefix+'-sequence.ts')};
export function legacySelect(definition,input,listening,priorIds=[],pins=[],excluded=[],excludedArtists=[],evaluationTime=globalThis.Date.now()){
const NativeDate=globalThis.Date;
const Date=class extends NativeDate{constructor(value?:string|number){super(value??evaluationTime)}static now(){return evaluationTime}};
${scorer.slice(scorer.indexOf('export type ListeningProfile')).replace(/\bexport /g,'')}
const candidates=()=>input.map(track=>({...track,...scoreCandidate({definition,artist:track.artist,album:track.album,title:track.title,year:track.year,tags:track.tags??{},profile:track.profile,listening})})).filter(track=>track.eligible);
const activeFeedback=()=>({pins:new Set(pins),excluded:new Set(excluded),artists:new Set(excludedArtists.map(norm))});
const previous=()=>new Set(priorIds);
${generate.slice(begin,end)}
return select(definition,listening);
}`;
  writeFileSync(prefix+'.ts',text);await esbuild.build({entryPoints:[prefix+'.ts'],outfile:prefix+'.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const manifest={revision,scope:'Frozen deployed selection and journey ordering functions; database reads replaced with controlled supplied fixtures and clock frozen to the recorded evaluation timestamp. No scoring rule, ordering, tie-break or count behaviour changed.',generateHash:hash(generate),scorerHash:hash(scorer),sequenceHash:hash(sequence),artifactHash:hash(readFileSync(prefix+'.mjs'))};
  writeFileSync(prefix+'-manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
}
main().catch(error=>{console.error(String(error));process.exitCode=1});
