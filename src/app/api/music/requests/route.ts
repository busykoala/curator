import { currentUser } from "@/features/auth/session";
import { listenerRequests } from "@/features/music/requests";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  const requests = listenerRequests(user.id);
  if (id) {
    const item = requests.find((item) => item.id === Number(id));
    return item
      ? Response.json(item)
      : Response.json({ error: "Request not found" }, { status: 404 });
  }
  return Response.json({ requests });
}
