import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import GlobalProviders from "./components/GlobalProviders";
import { DARK_MODE_DETECT_SCRIPT } from "@/lib/theme-detect-script";

const dmSans = localFont({
  src: [
    { path: "./fonts/dm-sans/DMSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans/DMSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/dm-sans/DMSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/dm-sans/DMSans-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/dm-sans/DMSans-Black.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Prism - Multi-Streamer Song Archive",
  description: "Discover and explore karaoke archives from your favorite VTubers.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DARK_MODE_DETECT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <GlobalProviders>
          {children}
        </GlobalProviders>
      </body>
    </html>
  );
}
