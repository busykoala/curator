import { db } from "@/features/db/client";

export type CuratorUser = {
  id: number;
  navidromeUserId: string;
  username: string;
  displayName: string;
  tokenStatus: "active" | "revoked" | "missing";
};

export type UserRow = {
  id: number;
  navidrome_user_id: string;
  username: string;
  display_name: string;
  token_status: CuratorUser["tokenStatus"];
};

export const mapUser = (row: UserRow): CuratorUser => ({
  id: row.id,
  navidromeUserId: row.navidrome_user_id,
  username: row.username,
  displayName: row.display_name,
  tokenStatus: row.token_status,
});

export function listCuratorUsers(): CuratorUser[] {
  return (db().prepare("SELECT id,navidrome_user_id,username,display_name,token_status FROM curator_users ORDER BY display_name COLLATE NOCASE").all() as UserRow[]).map(mapUser);
}
