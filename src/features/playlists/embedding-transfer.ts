import Database from 'better-sqlite3';
import {chmodSync,existsSync} from 'node:fs';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {playlistTrackEvidence} from './evidence-repository';
import {canonicalTrackDescription,descriptionHash} from './retrieval';
import {trackEvidenceVersion} from './track-evidence';

type Row={file_id:number;model_version:string;content_hash:string;vector:Buffer;dimensions:number};
function valid(row:Row){
  if(row.dimensions!==1024||!Buffer.isBuffer(row.vector)||row.vector.byteLength!==4096)return false;
  const values=new Float32Array(Uint8Array.from(row.vector).buffer);
  return values.every(Number.isFinite)&&values.some(value=>value!==0);
}
function currentHash(fileId:number){
  const file=db().prepare(`SELECT f.artist_name,f.album_name,f.tags_json FROM files f JOIN track_profiles p ON p.file_id=f.id
    WHERE f.id=? AND f.status='written' AND p.status='complete'`).get(fileId) as {artist_name:string;album_name:string;tags_json:string}|undefined;
  if(!file)return null;const evidence=playlistTrackEvidence(fileId);if(!evidence)return null;
  const tags=JSON.parse(file.tags_json),title=String(Array.isArray(tags.title)?tags.title[0]:tags.title??'');
  return descriptionHash(canonicalTrackDescription({artist:file.artist_name,album:file.album_name,title},evidence));
}
// Transfer vectors only: never copy an evaluation database, owner histories,
// playlists, settings, tokens, conversations or synthetic fixture state.
export function exportPlaylistEmbeddingCache(path:string){
  if(existsSync(path))throw Error('Embedding export already exists');
  const output=new Database(path);chmodSync(path,0o600);let exported=0,skipped=0;
  try{
    output.exec('CREATE TABLE manifest(version INTEGER,model_version TEXT,evidence_version INTEGER);CREATE TABLE vectors(file_id INTEGER PRIMARY KEY,model_version TEXT,content_hash TEXT,vector BLOB,dimensions INTEGER)');
    output.prepare('INSERT INTO manifest VALUES(1,?,?)').run(config.CURATOR_EMBEDDING_VERSION,trackEvidenceVersion);
    const insert=output.prepare('INSERT INTO vectors VALUES(?,?,?,?,?)');
    output.transaction(()=>{for(const row of db().prepare('SELECT file_id,model_version,content_hash,vector,dimensions FROM playlist_track_embeddings WHERE model_version=?').all(config.CURATOR_EMBEDDING_VERSION) as Row[]){
      if(!valid(row)||currentHash(row.file_id)!==row.content_hash){skipped++;continue}
      insert.run(row.file_id,row.model_version,row.content_hash,row.vector,row.dimensions);exported++;
    }})();
    return{exported,skipped,model:config.CURATOR_EMBEDDING_VERSION,evidenceVersion:trackEvidenceVersion};
  }finally{output.close()}
}
export function importPlaylistEmbeddingCache(path:string){
  const source=new Database(path,{readonly:true,fileMustExist:true});let imported=0,skipped=0,alreadyPresent=0;
  try{
    const manifest=source.prepare('SELECT version,model_version,evidence_version FROM manifest').all() as Array<{version:number;model_version:string;evidence_version:number}>;
    if(manifest.length!==1||manifest[0].version!==1||manifest[0].model_version!==config.CURATOR_EMBEDDING_VERSION||manifest[0].evidence_version!==trackEvidenceVersion)throw Error('Embedding export version/model is incompatible');
    const existing=db().prepare('SELECT file_id,model_version,content_hash,vector,dimensions FROM playlist_track_embeddings WHERE file_id=? AND model_version=?'),insert=db().prepare(`INSERT INTO playlist_track_embeddings(file_id,model_version,content_hash,vector,dimensions,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(file_id,model_version) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector,dimensions=excluded.dimensions,updated_at=excluded.updated_at`);
    for(const row of source.prepare('SELECT file_id,model_version,content_hash,vector,dimensions FROM vectors ORDER BY file_id').iterate() as Iterable<Row>){
      if(row.model_version!==config.CURATOR_EMBEDDING_VERSION||!valid(row)||currentHash(row.file_id)!==row.content_hash){skipped++;continue}
      const cached=existing.get(row.file_id,row.model_version) as Row|undefined;
      if(cached?.content_hash===row.content_hash&&valid(cached)){alreadyPresent++;continue}
      insert.run(row.file_id,row.model_version,row.content_hash,row.vector,row.dimensions,Date.now());imported++;
    }
    return{imported,skipped,alreadyPresent,model:config.CURATOR_EMBEDDING_VERSION};
  }finally{source.close()}
}
