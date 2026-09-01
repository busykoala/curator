import argon2 from "argon2";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
const COOKIE = "curator_session";
async function passwordHash(): Promise<string> { const existing = stateGet("admin_password_hash"); if (existing) return existing; const hash = await argon2.hash(config.CURATOR_ADMIN_PASSWORD, { type: argon2.argon2id }); stateSet("admin_password_hash", hash); return hash; }
export async function verifyPassword(value: string, ip: string): Promise<boolean> { const cutoff = Date.now() - 20 * 60_000; db().prepare("DELETE FROM auth_attempts WHERE attempted_at<?").run(cutoff); const recent = db().prepare("SELECT count(*) count FROM auth_attempts WHERE ip=? AND attempted_at>? AND success=0").get(ip, cutoff) as { count: number }; if (recent.count >= 5) return false; const valid = await argon2.verify(await passwordHash(), value); db().prepare("INSERT INTO auth_attempts(ip,attempted_at,success) VALUES (?,?,?)").run(ip, Date.now(), valid ? 1 : 0); return valid; }
function sign(payload: string): string { return createHmac("sha256", config.CURATOR_SESSION_SECRET).update(payload).digest("base64url"); }
export async function createSession(): Promise<void> { const payload = `${Date.now() + 7 * 86400_000}.${randomBytes(16).toString("base64url")}`; (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "strict", secure: false, maxAge: 7 * 86400, path: "/" }); }
export async function clearSession(): Promise<void> { (await cookies()).delete(COOKIE); }
export async function authenticated(): Promise<boolean> { const token = (await cookies()).get(COOKIE)?.value; if (!token) return false; const parts = token.split("."); if (parts.length !== 3 || Number(parts[0]) < Date.now()) return false; const payload = `${parts[0]}.${parts[1]}`; const expected = Buffer.from(sign(payload)), actual = Buffer.from(parts[2]); return expected.length === actual.length && timingSafeEqual(expected, actual); }
export function sameOrigin(request: Request): boolean { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).host === request.headers.get("host"); } catch { return false; } }
