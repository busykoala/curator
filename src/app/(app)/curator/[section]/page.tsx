import { notFound } from "next/navigation";
import { CuratorPage } from "@/components/curator-page";
export default async function CarePage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!["review", "activity", "diagnostics"].includes(section)) notFound();
  return <CuratorPage section={section} />;
}
