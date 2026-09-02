import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import GlobalProviders from "./components/GlobalProviders";
import { DARK_MODE_DETECT_SCRIPT } from "@/lib/theme-detect-script";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
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
