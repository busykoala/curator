import { MusicRequests } from "@/components/music-requests";
export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <MusicRequests id={Number((await params).id)} />;
}
