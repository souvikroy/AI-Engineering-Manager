"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  size = "sm",
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "xs" | "sm" | "md"; children: ReactNode }) {
  const variants: Record<Variant, string> = {
    primary:
      "bg-accent text-bg hover:bg-accent/90 shadow-[0_0_0_1px_rgba(167,139,250,0.35),0_8px_20px_-8px_rgba(167,139,250,0.40)] disabled:bg-accent/40",
    secondary:
      "bg-white/[0.06] text-ink hover:bg-white/[0.10] ring-1 ring-inset ring-white/[0.08] hover:ring-white/[0.14]",
    ghost: "text-ink-dim hover:text-ink hover:bg-surface",
  };
  const sizes: Record<string, string> = {
    xs: "px-2 py-1 text-[11px]",
    sm: "px-3 py-1.5 text-[12.5px]",
    md: "px-4 py-2 text-[13.5px]",
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}
