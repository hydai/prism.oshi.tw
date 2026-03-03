import { NextResponse } from 'next/server';
import { readSongMetadata, readArtistInfo } from '@/lib/data';
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
  const songMetadata = readSongMetadata(streamer);
  const artistInfo = readArtistInfo(streamer);
  return NextResponse.json({ songMetadata, artistInfo });
}
