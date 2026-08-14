interface YouTubeEmbedProps {
  videoId: string;
  title: string;
  startSeconds?: number;
  className?: string;
}

const permissions = [
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'gyroscope',
  'picture-in-picture',
  'web-share',
].join('; ');

const sandboxPermissions = [
  'allow-scripts',
  'allow-same-origin',
  'allow-presentation',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
].join(' ');

function embedUrl(videoId: string, startSeconds?: number): string {
  const encodedVideoId = encodeURIComponent(videoId.trim());
  const start = typeof startSeconds === 'number' && Number.isFinite(startSeconds)
    ? Math.max(0, Math.floor(startSeconds))
    : undefined;
  const query = start === undefined ? '' : `?start=${start}`;
  return `https://www.youtube.com/embed/${encodedVideoId}${query}`;
}

export default function YouTubeEmbed({
  videoId,
  title,
  startSeconds,
  className = 'h-full w-full',
}: YouTubeEmbedProps) {
  return (
    <iframe
      src={embedUrl(videoId, startSeconds)}
      title={title}
      sandbox={sandboxPermissions}
      allow={permissions}
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      className={className}
    />
  );
}
