import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "AI EM Copilot",
  description: "Decision layer for engineering leadership.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <div className="flex min-h-screen relative">
          <Sidebar />
          <main className="flex-1 ml-[232px] relative z-10">
            <div className="max-w-6xl mx-auto px-8 py-10">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
