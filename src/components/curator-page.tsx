"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CuratorConsole } from "./curator-console";
import { BackLink, PageHeader } from "./ui";
import { readJson } from "./http";

type Summary = {
  paused: boolean;
  metrics: Record<string, number>;
  operational: { running: boolean; phase: string; lastError?: string };
  jobs?: Array<{
    phase: string;
    status: string;
    subject: string;
    progress_json?: string;
  }>;
};

export function CuratorPage({ section = "overview" }: { section?: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/summary", { cache: "no-store" });
      setData(await readJson<Summary>(response, "Curator summary unavailable"));
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Curator summary unavailable",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(
      () => void refresh(),
      data?.operational.running ? 5_000 : 15_000,
    );
    return () => clearInterval(timer);
  }, [refresh, data?.operational.running]);

  async function action(name: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name }),
      });
      await readJson(response, "Curator action failed");
      await refresh();
      setNotice(`${name.replaceAll("-", " ")} accepted.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Curator action failed",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data && notice)
    return (
      <div className="empty-state">
        <RefreshCw />
        <h3>Curator status is unavailable</h3>
        <p>{notice}</p>
        <button className="primary-button" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  return (
    <div className="routed-workspace">
      <BackLink href={section === "overview" ? "/settings" : "/curator"}>
        {section === "overview" ? "Account and settings" : "Library care"}
      </BackLink>
      <PageHeader
        title={
          section === "review"
            ? "Review metadata"
            : section === "activity"
              ? "Activity"
              : section === "diagnostics"
                ? "Diagnostics"
                : "Library care"
        }
        description="Changes here apply to the shared library."
      />
      {notice && (
        <div className="playlist-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => void refresh()}>
            <RefreshCw />
            Refresh
          </button>
        </div>
      )}
      {data ? (
        <CuratorConsole
          data={data}
          busy={busy}
          action={action}
          section={section}
        />
      ) : (
        <div className="playlist-loading">
          <RefreshCw className="spin" />
          Loading Curator status…
        </div>
      )}
    </div>
  );
}
