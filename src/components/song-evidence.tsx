import type {SongExplanation} from '@/features/playlists/song-explanation';
const labels:Record<string,string>={genre:'Genre',style:'Style',mood:'Mood',listeningContexts:'Context',vocalProfile:'Voice',instrumentation:'Instruments',energy:'Energy'};
export function SongEvidence({explanation}:{explanation?:SongExplanation|null}){
  if(!explanation)return null;
  return<>
    {explanation.fields.length>0&&<ul>{explanation.fields.map(field=><li key={field.name}>
      {labels[field.name]??field.name}: {field.value.replaceAll('_',' ')}
      <span className="muted"> · {field.source==='model_inference'?'inferred':field.source==='user_override'?'your edit':field.source==='external'?'source evidence':'file tag'}</span>
    </li>)}</ul>}
    {explanation.uncertainty.map(note=><p key={note}>{note}</p>)}
    {explanation.references.length>0&&<ul>{explanation.references.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{new URL(source.url).hostname} · {source.scope} evidence</a></li>)}</ul>}
  </>;
}
