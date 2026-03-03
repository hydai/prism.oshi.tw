'use client';

import { useStreamer } from '../contexts/StreamerContext';

export function useStreamerHref(path: string): string {
  const { slug } = useStreamer();
  return `/${slug}${path}`;
}
