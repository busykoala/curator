import {db} from '@/features/db/client';
import {aiModel,type AiAttempt} from '@/features/ai/client';
import type {PlaylistDefinition} from './types';

export function playlistAttemptRecorder(playlist:PlaylistDefinition,purpose:string){
  return(attempt:AiAttempt)=>{
    db().prepare(`INSERT INTO playlist_ai_attempts(playlist_id,owner_user_id,purpose,model,status,http_status,duration_ms,usage_json,error,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(playlist.id,playlist.ownerUserId,purpose,aiModel,attempt.outcome,attempt.httpStatus,attempt.durationMs,attempt.usage?JSON.stringify(attempt.usage):null,attempt.error??'',Date.now());
  };
}
