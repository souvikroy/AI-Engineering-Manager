"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocArtifact } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

function formatAge(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function DocPreview({
  artifact,
  citations,
}: {
  artifact: DocArtifact;
  citations: Citation[];
}) {
  const freshness = formatAge(artifact.freshness_seconds);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
          <span>Report</span>
          {freshness ? (
            <>
              <span className="text-ink-ghost">·</span>
              <span className="normal-case tracking-normal">{freshness}</span>
            </>
          ) : null}
        </div>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight2 text-ink">
          {artifact.title}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="prose-thin max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.markdown}
          </ReactMarkdown>
        </div>
      </div>
      {citations.length > 0 ? (
        <div className="border-t border-border px-6 py-3 text-[11px] text-ink-faint">
          <span className="font-medium uppercase tracking-kicker text-[10px] mr-2">
            Sources
          </span>
          {citations.slice(0, 6).map((c, i) => (
            <span key={`${c.kind}:${c.id}:${i}`} className="mr-2">
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {c.kind}/{c.id}
                </a>
              ) : (
                <span>
                  {c.kind}/{c.id}
                </span>
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
