'use client';

export default function YouTubePlayerContainer() {
  // YouTube player div - always hidden, YouTube API manages it
  return (
    <div
      id="youtube-player"
      className="fixed top-0 left-0 w-0 h-0 opacity-0 pointer-events-none overflow-hidden"
    />
  );
}
