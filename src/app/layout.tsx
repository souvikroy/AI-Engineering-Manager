import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "CTO Brain — your AI chief of staff",
  description:
    "Decision layer for engineering leadership. One synthesis of standups, OKRs, incidents, and on-call.",
  icons: {
    icon: "/cto-brain-logo.png",
    shortcut: "/cto-brain-logo.png",
    apple: "/cto-brain-logo.png",
  },
  openGraph: {
    title: "CTO Brain",
    description: "Your AI chief of staff for engineering leadership.",
    images: ["/cto-brain-logo.png"],
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
