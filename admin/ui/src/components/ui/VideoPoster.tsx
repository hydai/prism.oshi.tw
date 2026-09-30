import { useEffect, useRef } from 'react';
import { youtubeThumbnailUrl } from '../../lib/youtube';
import YouTubeEmbed from '../YouTubeEmbed';
import { Icon } from './Icon';

/**
 * A video that loads on demand: the thumbnail behind a play button until the page sets `active`,
 * then `YouTubeEmbed` in the same 16:9 box. Controlled, so a page can let one poster play at a time
 * (`onActivate` sets which one is active; a poster whose `active` goes false is a poster again).
 * Pass `videoId` trimmed: the thumbnail encodes it as given.
 */
export function VideoPoster({
  videoId,
  title,
  startSeconds,
  active,
  onActivate,
}: {
  videoId: string;
  title: string;
  startSeconds?: number;
  active: boolean;
  onActivate: () => void;
}) {
  const playerBox = useRef<HTMLDivElement>(null);
  // The play button is gone once the player replaces it, so a button that held focus hands it to
  // the player rather than to <body>. Read once, when `active` turns true: an activation that came
  // from anywhere else (the page, another control) leaves focus where it is.
  const buttonHeldFocus = useRef(false);

  useEffect(() => {
    if (!active || !buttonHeldFocus.current) return;
    buttonHeldFocus.current = false;
    playerBox.current?.querySelector('iframe')?.focus();
  }, [active]);

  if (active) {
    return (
      <div ref={playerBox} className="aspect-video w-full overflow-hidden rounded-radius-lg bg-track">
        <YouTubeEmbed videoId={videoId} title={title} startSeconds={startSeconds} />
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Play ${title}`}
      onClick={(event) => {
        buttonHeldFocus.current = document.activeElement === event.currentTarget;
        onActivate();
      }}
      className="group relative block aspect-video w-full overflow-hidden rounded-radius-lg bg-track focus-visible:outline-none focus-visible:shadow-focus"
    >
      <img src={youtubeThumbnailUrl(videoId)} alt="" loading="lazy" className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-circle bg-accent text-white shadow-primary transition-[filter] group-hover:brightness-105">
          <Icon name="play" size={20} />
        </span>
      </span>
    </button>
  );
}
