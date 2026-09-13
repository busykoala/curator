import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "@/config";
import { db } from "@/features/db/client";
import type { CuratorUser } from "./users";

type AuthResult = { AccessToken?: string; User?: { Id?: string; Name?: string } };
const base = () => `${config.NAVIDROME_URL.replace(/\/$/, "")}/jellyfin`;
const key = () => createHash("sha256").update(config.CURATOR_CREDENTIAL_KEY).digest();
function seal(token: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv); const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]); return { ciphertext: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") }; }

export function openUserToken(userId: number): string | null {
  const row = db().prepare("SELECT token_ciphertext,token_iv,token_tag FROM curator_users WHERE id=?").get(userId) as { token_ciphertext: string | null; token_iv: string | null; token_tag: string | null } | undefined;
  if (!row?.token_ciphertext || !row.token_iv || !row.token_tag) return null;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(row.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.token_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export async function authenticateNavidrome(username: string, password: string) {
  const response = await fetch(`${base()}/Users/AuthenticateByName`, { method: "POST", headers: { "Content-Type": "application/json", "X-Emby-Authorization": 'MediaBrowser Client="Music Curator", Device="Curator", DeviceId="curator-web", Version="1.0.0"' }, body: JSON.stringify({ Username: username, Pw: password }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Invalid Navidrome username or password" : `Navidrome login failed (${response.status})`);
  const result = await response.json() as AuthResult;
  if (!result.AccessToken || !result.User?.Id || !result.User.Name) throw new Error("Navidrome returned an incomplete login response");
  return { token: result.AccessToken, navidromeUserId: result.User.Id, username: result.User.Name, displayName: result.User.Name };
}

export function provisionUser(value: { token: string; navidromeUserId: string; username: string; displayName: string }): CuratorUser {
  const encrypted = value.token ? seal(value.token) : null;
  const row = db().prepare(`INSERT INTO curator_users(navidrome_user_id,username,display_name,token_ciphertext,token_iv,token_tag,token_status,legacy)
    VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(username) DO UPDATE SET navidrome_user_id=excluded.navidrome_user_id,display_name=excluded.display_name,token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,token_tag=excluded.token_tag,token_status='active',legacy=0,last_seen_at=CURRENT_TIMESTAMP RETURNING id,navidrome_user_id,username,display_name,token_status`).get(value.navidromeUserId, value.username, value.displayName, encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.tag ?? null, "active") as { id: number; navidrome_user_id: string; username: string; display_name: string; token_status: CuratorUser["tokenStatus"] };
  db().prepare("UPDATE smart_playlists SET owner_user_id=? WHERE owner_user_id IS NULL").run(row.id);
  db().prepare("UPDATE playlist_runs SET owner_user_id=? WHERE owner_user_id IS NULL AND playlist_id IN (SELECT id FROM smart_playlists WHERE owner_user_id=?)").run(row.id, row.id);
  return { id: row.id, navidromeUserId: row.navidrome_user_id, username: row.username, displayName: row.display_name, tokenStatus: row.token_status };
}

export async function jellyfinCall<T>(userId: number, path: string, init: RequestInit = {}): Promise<T> {
  const token = openUserToken(userId);
  if (!token) throw new Error("Playlist owner must sign in to Navidrome again");
  const response = await fetch(`${base()}/${path.replace(/^\//, "")}`, { ...init, headers: { "Content-Type": "application/json", "X-Emby-Token": token, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(12_000), cache: "no-store" });
  if (response.status === 401) { db().prepare("UPDATE curator_users SET token_status='revoked' WHERE id=?").run(userId); console.warn(JSON.stringify({event:"navidrome_token_revoked",userId,at:new Date().toISOString()})); throw new Error("Playlist owner must sign in to Navidrome again"); }
  if (!response.ok) throw new Error(`Navidrome ${path} failed (${response.status}): ${await response.text()}`);
  db().prepare("UPDATE curator_users SET token_status='active',last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(userId);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
