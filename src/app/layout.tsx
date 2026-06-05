import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces } from "next/font/google";
import "./globals.css";

// Variable serif used only for display-size headings + serif italic accents.
// Body and UI stay on Geist Sans.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

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
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable}`}
    >
      <body className="font-sans">
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}
