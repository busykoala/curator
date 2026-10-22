import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {revalidateUnchangedPlaylistEmbeddings,playlistEmbeddingBacklog} from '../src/features/playlists/retrieval';
if(!config.DATABASE_PATH.startsWith('/tmp/curator-renewal-eval-')||process.env.PLAYLIST_EVAL_DB_PATH!==config.DATABASE_PATH)throw Error('Only the explicitly supplied private evaluation copy is permitted');
try{
  const before=playlistEmbeddingBacklog(),result=revalidateUnchangedPlaylistEmbeddings(2048);
  console.log(JSON.stringify({at:new Date().toISOString(),scope:'Description-hash verification only; zero inference/provider requests; changed documents remain due.',before,...result,remaining:playlistEmbeddingBacklog()}));
}finally{db().close()}
