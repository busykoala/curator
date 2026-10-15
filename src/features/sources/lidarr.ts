import { config } from "@/config";
import { stateGet, stateSet } from "@/features/db/client";
import {posix} from 'node:path';
async function request(path: string, init?: RequestInit): Promise<Response> { return fetch(`${config.LIDARR_URL}/api/v1${path}`, { ...init, headers: { "X-Api-Key": config.LIDARR_API_KEY, "Content-Type": "application/json", ...init?.headers }, signal: AbortSignal.timeout(15_000) }); }
export async function importedSinceLastPoll(): Promise<boolean> { if (!config.LIDARR_API_KEY) return false; const response = await request("/history?page=1&pageSize=1&sortKey=date&sortDirection=descending&eventType=3"); if (!response.ok) return false; const data = await response.json() as { records?: Array<{ date: string }> }; const newest = data.records?.[0]?.date ?? ""; const previous = stateGet("lidarr_last_import"); if (newest) stateSet("lidarr_last_import", newest); return Boolean(previous && newest && previous !== newest); }
export async function rescanFolders(folders: string[]): Promise<void> {
  if (!config.LIDARR_API_KEY || !folders.length) return;
  const mapped=folders.map(folder=>{const relative=posix.relative(config.MUSIC_ROOT,folder);if(relative==='..'||relative.startsWith('../')||posix.isAbsolute(relative))throw Error('Rescan folder is outside the music library');return posix.join(config.LIDARR_MUSIC_ROOT,relative)});
  const response=await request('/command',{method:'POST',body:JSON.stringify({name:'RescanFolders',folders:[...new Set(mapped)]})});
  if(!response.ok)throw Error(`Lidarr rescan failed (${response.status})`);
}
