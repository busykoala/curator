import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "@/config";
import { schemaSql } from "./schema";
const globalDb = globalThis as typeof globalThis & {
  curatorDb?: Database.Database;
};
function tableColumns(instance: Database.Database, table: string) {
  return new Set(
    (
      instance.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}
function addColumns(
  instance: Database.Database,
  table: string,
  additions: ReadonlyArray<readonly [string, string]>,
) {
  const existing = tableColumns(instance, table);
  for (const [name, type] of additions)
    if (!existing.has(name))
      instance.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
function migrate(instance: Database.Database) {
  const applied = new Set(
    (
      instance.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
  );
  const migration = (version: number, run: () => void) => {
    if (applied.has(version)) return;
    // Web and supervised workers can start together. Serialize the migration and
    // recheck inside its write transaction rather than trusting an earlier read.
    instance
      .transaction(() => {
        if (
          instance
            .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
            .get(version)
        )
          return;
        run();
        instance
          .prepare("INSERT INTO schema_migrations(version) VALUES (?)")
          .run(version);
      })
      .immediate();
  };
  migration(3, () => {
    addColumns(instance, "smart_playlists", [
      ["owner_user_id", "INTEGER REFERENCES curator_users(id)"],
    ]);
    addColumns(instance, "playlist_runs", [
      ["owner_user_id", "INTEGER REFERENCES curator_users(id)"],
    ]);
    addColumns(instance, "listening_clusters", [
      ["user_id", "INTEGER REFERENCES curator_users(id)"],
    ]);
    addColumns(instance, "navidrome_track_map", [["jellyfin_song_id", "TEXT"]]);
    instance.exec("DROP INDEX IF EXISTS smart_playlists_name");
    instance.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS smart_playlists_owner_name ON smart_playlists(coalesce(owner_user_id,0),lower(name))",
    );
    instance.exec(
      "CREATE INDEX IF NOT EXISTS smart_playlists_owner ON smart_playlists(owner_user_id,enabled)",
    );
    instance.exec(
      "CREATE INDEX IF NOT EXISTS listening_clusters_user ON listening_clusters(user_id,weight DESC)",
    );
    instance.exec(
      "CREATE TABLE IF NOT EXISTS music_requests(id INTEGER PRIMARY KEY,requester_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,foreign_artist_id TEXT NOT NULL,foreign_album_id TEXT NOT NULL,lidarr_artist_id INTEGER,lidarr_album_id INTEGER,artist TEXT NOT NULL DEFAULT '',album TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',detail_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(requester_user_id,foreign_album_id))",
    );
    instance.exec(
      "CREATE INDEX IF NOT EXISTS music_requests_user ON music_requests(requester_user_id,updated_at DESC)",
    );
  });
  migration(4, () => {
    instance.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS files_search USING fts5(file_id UNINDEXED,title,artist,album,tags,tokenize='unicode61 remove_diacritics 2')",
    );
    instance.exec("DELETE FROM files_search");
    instance.exec(
      "INSERT INTO files_search(file_id,title,artist,album,tags) SELECT id,CASE WHEN json_valid(tags_json) THEN coalesce(json_extract(tags_json,'$.title'),'') ELSE '' END,artist_name,album_name,tags_json FROM files",
    );
    instance.exec(
      "CREATE TRIGGER IF NOT EXISTS files_search_insert AFTER INSERT ON files BEGIN INSERT INTO files_search(file_id,title,artist,album,tags) VALUES(new.id,CASE WHEN json_valid(new.tags_json) THEN coalesce(json_extract(new.tags_json,'$.title'),'') ELSE '' END,new.artist_name,new.album_name,new.tags_json); END",
    );
    instance.exec(
      "CREATE TRIGGER IF NOT EXISTS files_search_delete AFTER DELETE ON files BEGIN DELETE FROM files_search WHERE file_id=old.id; END",
    );
    instance.exec(
      "CREATE TRIGGER IF NOT EXISTS files_search_update AFTER UPDATE OF tags_json,artist_name,album_name ON files BEGIN DELETE FROM files_search WHERE file_id=old.id; INSERT INTO files_search(file_id,title,artist,album,tags) VALUES(new.id,CASE WHEN json_valid(new.tags_json) THEN coalesce(json_extract(new.tags_json,'$.title'),'') ELSE '' END,new.artist_name,new.album_name,new.tags_json); END",
    );
  });
  migration(5, () => {
    instance.exec("DROP INDEX IF EXISTS smart_playlists_name");
    instance.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS smart_playlists_owner_name ON smart_playlists(coalesce(owner_user_id,0),lower(name))",
    );
  });
  migration(7, () => {
    addColumns(instance, "smart_playlists", [
      ["automatic", "INTEGER NOT NULL DEFAULT 0"],
    ]);
    // The previous interface treated all depth and rediscovery playlists as automatic.
    instance.exec(
      "UPDATE smart_playlists SET automatic=1 WHERE category IN ('depth','rediscovery')",
    );
  });
  migration(6, () => {
    // Listening clusters are derived data. Rebuild them with per-user signals
    // after removing the old library-wide fallback scoring.
    instance.exec("DELETE FROM listening_clusters");
    instance.exec(
      "DELETE FROM state WHERE key LIKE 'listening_clusters_refreshed:%'",
    );
  });
  migration(8, () => {
    // Bind existing picks before their first edit or deletion. A NULL playlist
    // records a dismissed pick; stable cluster keys survive renames and refreshes.
    instance.exec(`INSERT OR IGNORE INTO automatic_playlist_choices(owner_user_id,default_key,playlist_id)
      SELECT p.owner_user_id,'depth:' || c.id,p.id FROM smart_playlists p JOIN listening_clusters c
      ON c.user_id=p.owner_user_id AND lower(p.name)=lower(c.label || ' Deep Dive')
      WHERE p.automatic=1 AND p.category='depth'`);
    instance.exec(`INSERT OR IGNORE INTO automatic_playlist_choices(owner_user_id,default_key,playlist_id)
      SELECT owner_user_id,'rediscovery:forgotten',id FROM smart_playlists
      WHERE automatic=1 AND category='rediscovery' AND lower(name)='forgotten favorites' AND owner_user_id IS NOT NULL`);
  });
  migration(9, () => {
    addColumns(instance, "playlist_feedback", [
      [
        "owner_user_id",
        "INTEGER REFERENCES curator_users(id) ON DELETE CASCADE",
      ],
    ]);
    instance.exec(
      "UPDATE playlist_feedback SET owner_user_id=(SELECT owner_user_id FROM smart_playlists WHERE id=playlist_feedback.playlist_id) WHERE playlist_id IS NOT NULL",
    );
    instance.exec(
      "CREATE INDEX IF NOT EXISTS playlist_feedback_owner ON playlist_feedback(owner_user_id,playlist_id,file_id)",
    );
  });
  migration(10, () => {
    // Keep every existing mix, its refresh preference, history, and native link.
    // Suggestions now become playlists only after an explicit create action.
    instance.exec("UPDATE smart_playlists SET automatic=0 WHERE automatic=1");
  });
  migration(11, () => {
    addColumns(instance, "playlist_chat_state", [
      ["read_revision", "INTEGER NOT NULL DEFAULT 0"],
    ]);
    instance.exec("UPDATE playlist_chat_state SET read_revision=revision");
    instance.exec(
      "CREATE TABLE IF NOT EXISTS listener_preferences(user_id INTEGER PRIMARY KEY REFERENCES curator_users(id) ON DELETE CASCADE,appearance TEXT NOT NULL DEFAULT 'system')",
    );
  });
  migration(12,()=>addColumns(instance,"acquisition_targets",[["wanted_since","TEXT"]]));
  migration(13,()=>{
    addColumns(instance,'smart_playlists',[["revision","INTEGER NOT NULL DEFAULT 1"]]);
    addColumns(instance,'playlist_runs',[["source_preview_id","INTEGER REFERENCES playlist_runs(id)"]]);
    instance.exec('CREATE UNIQUE INDEX IF NOT EXISTS playlist_runs_source_preview ON playlist_runs(source_preview_id) WHERE source_preview_id IS NOT NULL');
    instance.exec(`CREATE TABLE IF NOT EXISTS playlist_refresh_jobs(
      id TEXT PRIMARY KEY,playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'nightly',revision INTEGER NOT NULL,
      mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',phase TEXT NOT NULL DEFAULT 'generate',
      attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,run_id INTEGER REFERENCES playlist_runs(id),
      error TEXT NOT NULL DEFAULT '',result_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      UNIQUE(playlist_id,scheduled_date,kind));
      CREATE INDEX IF NOT EXISTS playlist_refresh_work ON playlist_refresh_jobs(status,next_attempt_at,created_at);
      CREATE TABLE IF NOT EXISTS playlist_publications(
      id TEXT PRIMARY KEY,playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,
      selection_hash TEXT NOT NULL,song_ids_json TEXT NOT NULL,previous_ids_json TEXT NOT NULL DEFAULT '[]',
      native_id TEXT,status TEXT NOT NULL DEFAULT 'prepared',error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(playlist_id,revision,selection_hash));`);
  });
  migration(14,()=>{
    addColumns(instance,'discovery_candidates',[["playlist_id","INTEGER REFERENCES smart_playlists(id) ON DELETE SET NULL"],["owner_user_id","INTEGER REFERENCES curator_users(id) ON DELETE SET NULL"]]);
    instance.exec(`UPDATE discovery_candidates SET playlist_id=(SELECT min(p.id) FROM smart_playlists p WHERE lower(p.name)=lower(discovery_candidates.lane) AND p.owner_user_id IS NOT NULL)
      WHERE (SELECT count(*) FROM smart_playlists p WHERE lower(p.name)=lower(discovery_candidates.lane) AND p.owner_user_id IS NOT NULL)=1;
      UPDATE discovery_candidates SET owner_user_id=(SELECT owner_user_id FROM smart_playlists WHERE id=playlist_id) WHERE playlist_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS playlist_discovery_releases(
        id TEXT PRIMARY KEY,artist_id TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,release_date TEXT,
        genres_json TEXT NOT NULL DEFAULT '[]',evidence_json TEXT NOT NULL DEFAULT '[]',identity_verified_at TEXT,
        lidarr_album_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS playlist_discovery_recommendations(
        id INTEGER PRIMARY KEY,playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
        owner_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES playlist_discovery_releases(id),status TEXT NOT NULL DEFAULT 'researched',
        rationale TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT 'research',message TEXT NOT NULL DEFAULT '',
        queued_at TEXT,last_progress_at TEXT,last_size_left INTEGER,cooldown_until TEXT,ready_at TEXT,boost_until TEXT,presented_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(playlist_id,release_id));
      CREATE INDEX IF NOT EXISTS playlist_discovery_work ON playlist_discovery_recommendations(playlist_id,status,cooldown_until);
      CREATE TABLE IF NOT EXISTS playlist_discovery_admissions(
        id TEXT PRIMARY KEY,playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES playlist_discovery_releases(id),status TEXT NOT NULL DEFAULT 'reserved',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS playlist_discovery_admissions_date ON playlist_discovery_admissions(created_at,status);
      INSERT OR IGNORE INTO playlist_discovery_releases(id,artist_id,artist,album,release_date,genres_json,evidence_json,lidarr_album_id,created_at)
        SELECT foreign_album_id,foreign_artist_id,artist,album,release_date,genres_json,json_object('legacySources',json(CASE WHEN json_valid(sources_json) THEN sources_json ELSE '[]' END)),lidarr_album_id,created_at FROM discovery_candidates
        WHERE playlist_id IS NOT NULL AND coalesce(foreign_album_id,'')<>'' AND coalesce(foreign_artist_id,'')<>'';
      INSERT OR IGNORE INTO playlist_discovery_recommendations(playlist_id,owner_user_id,release_id,status,rationale,origin,message,queued_at,last_progress_at,last_size_left,created_at)
        SELECT playlist_id,owner_user_id,foreign_album_id,CASE WHEN status IN ('queued','downloading') THEN status ELSE 'researched' END,rationale,'legacy',coalesce(message,''),queued_at,last_progress_at,last_size_left,created_at
        FROM discovery_candidates WHERE playlist_id IS NOT NULL AND coalesce(foreign_album_id,'')<>'' AND coalesce(foreign_artist_id,'')<>'';`);
  });
  migration(15,()=>instance.exec(`
    CREATE TABLE IF NOT EXISTS playlist_source_cache(cache_key TEXT PRIMARY KEY,provider TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,fetched_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlist_source_requests(id INTEGER PRIMARY KEY,provider TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'started',detail TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS playlist_source_requests_daily ON playlist_source_requests(created_at,kind);
  `));
  migration(16,()=>instance.exec(`CREATE TABLE IF NOT EXISTS listener_music_snapshots(
    owner_user_id INTEGER PRIMARY KEY REFERENCES curator_users(id) ON DELETE CASCADE,
    songs_json TEXT NOT NULL DEFAULT '[]',complete INTEGER NOT NULL DEFAULT 0,
    captured_at INTEGER NOT NULL DEFAULT 0,last_attempt_at INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS playlist_track_evidence(file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,source_hash TEXT NOT NULL,evidence_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`));
  migration(17,()=>instance.exec(`CREATE TABLE IF NOT EXISTS playlist_metadata_reviews(
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,priority INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',source_hash TEXT NOT NULL DEFAULT '',
    facts_json TEXT NOT NULL DEFAULT '[]',next_retry_at INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlist_metadata_review_attempts(id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS playlist_metadata_review_daily ON playlist_metadata_review_attempts(created_at);`));
  migration(18,()=>instance.exec(`
    CREATE TABLE IF NOT EXISTS playlist_intents(
      playlist_id INTEGER PRIMARY KEY REFERENCES smart_playlists(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL,intent_json TEXT NOT NULL,detail_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS playlist_exposure(
      owner_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,
      playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
      run_id INTEGER NOT NULL REFERENCES playlist_runs(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      recording_key TEXT NOT NULL,exposed_at INTEGER NOT NULL,removed_at INTEGER,
      PRIMARY KEY(run_id,file_id));
    CREATE INDEX IF NOT EXISTS playlist_exposure_owner ON playlist_exposure(owner_user_id,recording_key,exposed_at);
  `));
  migration(19,()=>instance.exec(`
    CREATE TABLE IF NOT EXISTS playlist_track_embeddings(
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,model_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,vector BLOB NOT NULL,dimensions INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(file_id,model_version));
    CREATE TABLE IF NOT EXISTS playlist_query_embeddings(
      content_hash TEXT NOT NULL,model_version TEXT NOT NULL,vector BLOB NOT NULL,dimensions INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(content_hash,model_version));
    CREATE TABLE IF NOT EXISTS playlist_ai_attempts(
      id INTEGER PRIMARY KEY,playlist_id INTEGER REFERENCES smart_playlists(id) ON DELETE SET NULL,
      owner_user_id INTEGER REFERENCES curator_users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,model TEXT NOT NULL,
      status TEXT NOT NULL,http_status INTEGER,duration_ms INTEGER NOT NULL,usage_json TEXT,error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlist_inference_queue(
      id TEXT PRIMARY KEY,priority TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlist_inference_slot(
      id INTEGER PRIMARY KEY CHECK(id=1),lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
  `));
  migration(20,()=>instance.exec(`CREATE TABLE IF NOT EXISTS playlist_refresh_requests(
    request_id TEXT PRIMARY KEY,playlist_id INTEGER NOT NULL REFERENCES smart_playlists(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES playlist_refresh_jobs(id) ON DELETE CASCADE);`));
  migration(21,()=>instance.exec('CREATE INDEX IF NOT EXISTS evidence_playlist_lookup ON evidence(entity_key,provider,fetched_at DESC)'));
  migration(22,()=>addColumns(instance,'listener_music_snapshots',[['identity_version','INTEGER NOT NULL DEFAULT 1']]));
  migration(23,()=>{
    addColumns(instance,'playlist_discovery_recommendations',[['evidence_json',"TEXT NOT NULL DEFAULT '[]'"]]);
    instance.exec(`CREATE TABLE IF NOT EXISTS playlist_discovery_evidence_review(
      release_id TEXT PRIMARY KEY REFERENCES playlist_discovery_releases(id),evidence_json TEXT NOT NULL,
      reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    const rows=instance.prepare('SELECT id,evidence_json FROM playlist_discovery_releases').all() as Array<{id:string;evidence_json:string}>;
    for(const row of rows){
      const count=(instance.prepare('SELECT count(*) n FROM playlist_discovery_recommendations WHERE release_id=?').get(row.id) as {n:number}).n;
      let evidence:Array<{provider?:string}>=[];try{const value=JSON.parse(row.evidence_json);if(Array.isArray(value))evidence=value}catch{/* Preserve malformed legacy data for review below. */}
      if(count===1)instance.prepare('UPDATE playlist_discovery_recommendations SET evidence_json=? WHERE release_id=?').run(row.evidence_json,row.id);
      else if(row.evidence_json!=='[]')instance.prepare('INSERT OR IGNORE INTO playlist_discovery_evidence_review(release_id,evidence_json,reason) VALUES(?,?,?)').run(row.id,row.evidence_json,'Shared legacy recommendation evidence has no unique playlist association');
      instance.prepare('UPDATE playlist_discovery_releases SET evidence_json=? WHERE id=?').run(JSON.stringify(evidence.filter(item=>item&&['musicbrainz','official-release'].includes(item.provider??''))),row.id);
    }
  });
}
export function db(): Database.Database {
  if (globalDb.curatorDb) return globalDb.curatorDb;
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
  const instance = new Database(config.DATABASE_PATH,{timeout:5000});
  try {
    // On an empty file, simultaneous workers can race the first DELETE→WAL
    // transition before the migration transaction exists. SQLite can report
    // SQLITE_BUSY immediately for this pragma; retry the transition briefly.
    const deadline=Date.now()+5000,pause=new Int32Array(new SharedArrayBuffer(4));
    for(;;){try{
      if(instance.pragma('journal_mode',{simple:true})!=='wal')instance.pragma('journal_mode=WAL');
      break;
    }catch(error){if((error as {code?:string}).code!=='SQLITE_BUSY'||Date.now()>=deadline)throw error;Atomics.wait(pause,0,0,50)}}
    instance.pragma("synchronous = NORMAL");
    instance.pragma("foreign_keys = ON");
    instance
      .transaction(() => {
        instance.exec(schemaSql);
        addColumns(instance, "jobs", [
          ["heartbeat_at", "TEXT"],
          ["progress_json", "TEXT DEFAULT '{}'"],
          ["error_detail", "TEXT"],
        ]);
        addColumns(instance, "discovery_candidates", [
          ["lidarr_artist_id", "INTEGER"],
          ["lidarr_album_id", "INTEGER"],
          ["queued_at", "TEXT"],
          ["last_search_at", "TEXT"],
          ["last_checked_at", "TEXT"],
          ["last_progress_at", "TEXT"],
          ["last_size_left", "INTEGER"],
          ["search_attempts", "INTEGER NOT NULL DEFAULT 0"],
          ["cooldown_until", "TEXT"],
          ["imported_at", "TEXT"],
        ]);
        instance
          .prepare(
            "INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)",
          )
          .run();
        migrate(instance);
      })
      .immediate();
    instance.pragma("busy_timeout = 2000");
  } catch (error) {
    instance.close();
    throw error;
  }
  globalDb.curatorDb = instance;
  return instance;
}
export function stateGet(key: string, fallback = ""): string {
  return (
    (
      db().prepare("SELECT value FROM state WHERE key=?").get(key) as
        | { value: string }
        | undefined
    )?.value ?? fallback
  );
}
export function stateSet(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
    )
    .run(key, value);
}
