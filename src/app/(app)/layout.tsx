import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/features/auth/session";
import { AppShell } from "@/components/app-shell";
export const dynamic = "force-dynamic";
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user)
    redirect(
      "/login?next=" +
        encodeURIComponent(
          (await headers()).get("x-curator-destination") ?? "/home",
        ),
    );
  return <AppShell user={user}>{children}</AppShell>;
}
