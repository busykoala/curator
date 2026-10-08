import { notFound } from "next/navigation";
import { PlaylistStudio } from "@/components/playlist-studio";
export default async function CreatePlaylistPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (
    !["chat", "mood", "rediscovery", "depth", "journey", "discovery"].includes(
      type,
    )
  )
    notFound();
  return <PlaylistStudio createType={type} />;
}
