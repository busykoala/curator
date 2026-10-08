import { notFound } from "next/navigation";
import { LibraryEntityView } from "@/components/library-entity-drawer";
import { browseViews } from "@/features/library/browse";
export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string; key: string }>;
  searchParams: Promise<{ edit?: string; from?: string }>;
}) {
  const { view, key } = await params,
    query = await searchParams;
  if (
    !(browseViews as readonly string[]).includes(view) ||
    view === "playlists"
  )
    notFound();
  return (
    <LibraryEntityView
      view={view}
      entityKey={key}
      editing={query.edit === "1"}
      from={query.from}
    />
  );
}
