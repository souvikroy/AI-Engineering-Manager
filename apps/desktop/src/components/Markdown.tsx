import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/cn";

marked.setOptions({
  gfm: true,
  breaks: false,
});

interface Props {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(source || "", { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [source]);

  return (
    <div
      className={cn(
        "prose-reviewer text-sm leading-relaxed",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
