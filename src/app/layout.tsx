import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

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
        <div className="flex min-h-screen relative">
          <Sidebar />
          <main className="flex-1 ml-[244px] relative z-10">
            <div className="max-w-6xl mx-auto px-10 py-12">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
