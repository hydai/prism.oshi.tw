import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="zh-TW">
      <body className="font-sans">
        {children}
      </body>
    </html>
  );
}
