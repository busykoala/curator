import { notFound } from "next/navigation";
import { currentUser } from "@/features/auth/session";
import { ownedPlaylist } from "@/features/playlists/access";
import { PlaylistStudio } from "@/components/playlist-studio";
export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id),
    user = await currentUser();
  if (!user || !ownedPlaylist(id, user.id)) notFound();
  return <PlaylistStudio id={id} />;
}
