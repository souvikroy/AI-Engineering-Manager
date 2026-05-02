"use client";

import { X } from "lucide-react";
import { DocPreview } from "./artifacts/DocPreview";
import { Leaderboard } from "./artifacts/Leaderboard";
import { CodeReview } from "./artifacts/CodeReview";
import type { ArtifactPayload } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

export type ChatArtifact = ArtifactPayload & { id: string; citations: Citation[] };

export function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: ChatArtifact;
  onClose: () => void;
}) {
  return (
    <div className="relative flex h-full flex-col bg-bg-elevated/95 border-l border-border overflow-hidden">
      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-20 inline-flex items-center justify-center w-7 h-7 rounded-lg border border-border bg-surface hover:bg-surface-hover text-ink-faint hover:text-ink transition-colors"
        aria-label="Close artifact"
      >
        <X className="h-4 w-4" />
      </button>
      {artifact.kind === "doc" ? (
        <DocPreview artifact={artifact.payload} citations={artifact.citations} />
      ) : artifact.kind === "leaderboard" ? (
        <Leaderboard artifact={artifact.payload} />
      ) : (
        <CodeReview artifact={artifact.payload} />
      )}
    </div>
  );
}
