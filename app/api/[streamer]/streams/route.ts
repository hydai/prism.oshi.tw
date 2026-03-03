import { NextResponse } from 'next/server';
import { readStreams } from '@/lib/data';
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
    const streams = readStreams(streamer);
    return NextResponse.json(streams);
  } catch {
    return NextResponse.json([], { status: 404 });
  }
}
