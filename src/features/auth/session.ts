import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/features/db/client";
import { mapUser, type CuratorUser, type UserRow } from "./users";
export { listCuratorUsers, type CuratorUser } from "./users";

const COOKIE = "curator_session";
const SESSION_SECONDS = 7 * 86_400;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function loginAllowed(ip: string) {
  const cutoff = Date.now() - 20 * 60_000;
  db().prepare("DELETE FROM auth_attempts WHERE attempted_at<?").run(cutoff);
  const recent = db().prepare("SELECT count(*) count FROM auth_attempts WHERE ip=? AND attempted_at>? AND success=0").get(ip, cutoff) as { count: number };
  return recent.count < 5;
}
export function recordLogin(ip: string, success: boolean) { db().prepare("INSERT INTO auth_attempts(ip,attempted_at,success) VALUES (?,?,?)").run(ip, Date.now(), success ? 1 : 0); }

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
  db().prepare("INSERT INTO sessions(id_hash,user_id,expires_at) VALUES (?,?,datetime('now','+7 days'))").run(digest(token), userId);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: SESSION_SECONDS, path: "/" });
}
export async function clearSession(): Promise<void> { const token = (await cookies()).get(COOKIE)?.value; if (token) db().prepare("DELETE FROM sessions WHERE id_hash=?").run(digest(token)); (await cookies()).delete(COOKIE); }
export async function currentUser(): Promise<CuratorUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db().prepare("SELECT u.* FROM sessions s JOIN curator_users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>CURRENT_TIMESTAMP").get(digest(token)) as UserRow | undefined;
  if (!row) return null;
  db().prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id_hash=?").run(digest(token));
  return mapUser(row);
}
export async function authenticated(): Promise<boolean> { return Boolean(await currentUser()); }
export function sameOrigin(request: Request): boolean { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).host === request.headers.get("host"); } catch { return false; } }
