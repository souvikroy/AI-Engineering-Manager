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
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-center gap-2 text-kicker">
          <span>✦ Report</span>
          {freshness ? (
            <>
              <span className="text-ink-ghost">·</span>
              <span>{freshness}</span>
            </>
          ) : null}
        </div>
        <h2 className="mt-2 font-display text-h1 text-ink-cream tracking-tight2 leading-tight">
          {artifact.title}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <article className="prose-editorial">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.markdown}
          </ReactMarkdown>
        </article>
      </div>
      {citations.length > 0 ? (
        <div className="px-8 py-4 border-t border-white/[0.04]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-kicker shrink-0 mr-1">✦ Sources</span>
            {citations.slice(0, 8).map((c, i) => (
              <span key={`${c.kind}:${c.id}:${i}`}>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-caption text-accent hover:underline decoration-accent/50 underline-offset-2 font-display italic"
                  >
                    {c.kind}<span className="text-ink-ghost not-italic">/</span>
                    <span className="font-mono not-italic text-[10.5px]">{c.id}</span>
                  </a>
                ) : (
                  <span className="text-caption text-ink-dim font-display italic">
                    {c.kind}<span className="text-ink-ghost not-italic">/</span>
                    <span className="font-mono not-italic text-[10.5px]">{c.id}</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
