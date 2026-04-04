import type { Metadata, Viewport } from "next";
import "./globals.css";
import GlobalProviders from "./components/GlobalProviders";

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
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark')}catch(e){}})()`,
        }} />
      </head>
      <body className="font-sans">
        <GlobalProviders>
          {children}
        </GlobalProviders>
      </body>
    </html>
  );
}
