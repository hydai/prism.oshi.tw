import { NextResponse } from 'next/server';
import { readSongs } from '@/lib/data';
import { getAllStreamerSlugs } from '@/lib/registry';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return getAllStreamerSlugs().map(slug => ({ streamer: slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ streamer: string }> }
) {
  const { streamer } = await params;
  try {
    const songs = readSongs(streamer);
    return NextResponse.json(songs);
  } catch {
    return NextResponse.json([], { status: 404 });
  }
}
