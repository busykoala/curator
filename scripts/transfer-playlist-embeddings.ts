import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {exportPlaylistEmbeddingCache,importPlaylistEmbeddingCache} from '../src/features/playlists/embedding-transfer';
const mode=process.argv[2],path=process.argv[3];
if(!path?.startsWith('/tmp/curator-playlist-vectors-')||!path.endsWith('.sqlite'))throw Error('Use an explicitly supplied temporary vector-only SQLite file');
if(mode==='export'&&!config.DATABASE_PATH.startsWith('/tmp/curator-renewal-eval-'))throw Error('Export is restricted to the private evaluation copy');
if(mode==='import'&&config.DATABASE_PATH!=='/app/data/curator.sqlite')throw Error('Import requires the explicit deployed Curator database');
if(!['import','export'].includes(mode))throw Error('Choose import or export');
try{console.log(JSON.stringify(mode==='export'?exportPlaylistEmbeddingCache(path):importPlaylistEmbeddingCache(path)))}finally{db().close()}
