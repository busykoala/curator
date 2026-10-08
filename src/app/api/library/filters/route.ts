import { authenticated } from "@/features/auth/session";
import { libraryFilterOptions } from "@/features/library/browse";
export async function GET() {
  if (!(await authenticated()))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(libraryFilterOptions());
}
