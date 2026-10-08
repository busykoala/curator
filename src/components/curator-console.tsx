"use client";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
} from "lucide-react";
import { LibraryIssues } from "./library-issues";
import { StackCards } from "./stack-cards";
import { AcquisitionPanel } from "./acquisition-panel";
type Job = {
  phase: string;
  status: string;
  subject: string;
  progress_json?: string;
  processedCount?: number;
  totalCount?: number;
};
type Summary = {
  paused: boolean;
  metrics: Record<string, number>;
  operational: { running: boolean; phase: string; lastError?: string };
  jobs?: Job[];
};
export function CuratorConsole({
  data,
  busy,
  action,
  section = "overview",
}: {
  data: Summary | null;
  busy: boolean;
  action: (name: string) => void;
  section?: string;
}) {
  if (!data) return <div role="status">Loading library care…</div>;
  const active = (data.jobs ?? []).filter((job) => job.status === "running"),
    issues = Number(data.metrics.issues ?? 0);
  if (section === "review") return <LibraryIssues />;
  if (section === "activity")
    return (
      <div className="care-workspace">
        <p className="muted">
          {data.paused
            ? "Automatic processing is paused."
            : data.operational.running
              ? `Processing ${data.operational.phase}. You can leave this page.`
              : "Automatic processing is on. Queued work continues at the next cycle."}
        </p>
        {data.operational.lastError && (
          <div className="inline-error">
            <strong>Last cycle needs attention</strong>
            <p>{data.operational.lastError}</p>
            <Link className="text-link" href="/curator/diagnostics">
              Open diagnostics
              <ArrowRight />
            </Link>
          </div>
        )}
        {(data.jobs ?? []).length ? (
          (data.jobs ?? []).map((job, index) => {
            let progress: Partial<Job> = {};
            try {
              progress = JSON.parse(job.progress_json ?? "{}");
            } catch {}
            const total = progress.totalCount ?? 0,
              done = progress.processedCount ?? 0;
            return (
              <article className="activity-row" key={index}>
                <Clock3 />
                <div>
                  <strong>
                    {job.subject || job.phase.replaceAll("_", " ")}
                  </strong>
                  <span>
                    {job.status} · {job.phase.replaceAll("_", " ")}
                  </span>
                  {job.status === "running" && total > 0 && (
                    <progress max={total} value={done} />
                  )}
                </div>
                {total > 0 && (
                  <small>
                    {done} / {total}
                  </small>
                )}
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            <CheckCircle2 />
            <h2>No recent jobs</h2>
            <p>Background work and its results will appear here.</p>
          </div>
        )}
      </div>
    );
  if (section === "diagnostics")
    return (
      <div className="care-workspace">
        <p className="muted">
          Connections and maintenance for the shared library.
        </p>
        <StackCards />
        <details className="diagnostic-section">
          <summary>Album acquisition controls</summary>
          <AcquisitionPanel />
        </details>
        <details className="diagnostic-section">
          <summary>Library processing controls</summary>
          <p className="muted small">
            These actions apply to the shared library and all listeners.
          </p>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => action(data.paused ? "resume" : "pause")}
            >
              {data.paused ? <Play /> : <Pause />}
              {data.paused ? "Resume automation" : "Pause automation"}
            </button>
            <button
              className="secondary-button"
              disabled={busy || (!data.paused && data.operational.running)}
              onClick={() => action("scan")}
            >
              <ScanLine />
              Scan now
            </button>
          </div>
          <div className="button-row section">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => action("retry-errors")}
            >
              <RotateCcw />
              Retry failed work
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => action("retry-categorization")}
            >
              Retry incomplete profiles
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => action("clear-cache")}
            >
              <RefreshCw />
              Refresh source cache
            </button>
          </div>
        </details>
        <Link className="text-link" href="/settings/processing">
          Processing settings
          <ArrowRight />
        </Link>
      </div>
    );
  return (
    <div className="care-workspace">
      <div className="notice-panel">
        <Clock3 />
        <span>
          {data.paused
            ? "Automatic processing is paused."
            : active.length
              ? `Background work is running (${active.length} active ${active.length === 1 ? "job" : "jobs"}). No action needed.`
              : "Automatic processing is on. Queued work continues in the background."}
        </span>
      </div>
      <div className="creation-options">
        <Link className="creation-option" href="/curator/review">
          <SlidersHorizontal />
          <span>
            <strong>Review metadata</strong>
            <small>
              Inspect catalogue matches, artwork, and album groupings
            </small>
          </span>
          <ArrowRight />
        </Link>
        <Link className="creation-option" href="/curator/activity">
          <Clock3 />
          <span>
            <strong>Activity</strong>
            <small>Background work and recent results</small>
          </span>
          <ArrowRight />
        </Link>
        <Link className="creation-option" href="/curator/diagnostics">
          <ScanLine />
          <span>
            <strong>Diagnostics</strong>
            <small>Connections, acquisition, and maintenance</small>
          </span>
          <ArrowRight />
        </Link>
      </div>
      <p className="muted small section">
        {Number(
          data.metrics.files ?? data.metrics.indexedFiles ?? 0,
        ).toLocaleString()}{" "}
        tracks indexed. Review decisions and automatic queues are shown
        separately.
      </p>
    </div>
  );
}
