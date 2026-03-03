import { notFound } from 'next/navigation';
import { getStreamerConfig, getAllStreamerSlugs } from '../../lib/registry';
import StreamerShell from './StreamerShell';

export function generateStaticParams() {
  return getAllStreamerSlugs().map(slug => ({ streamer: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ streamer: string }> }) {
  const { streamer } = await params;
  const config = getStreamerConfig(streamer);
  if (!config) return {};

  return {
    title: `${config.brandName} - ${config.subTitle}`,
    description: config.description,
  };
}

export default async function StreamerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ streamer: string }>;
}) {
  const { streamer } = await params;
  const config = getStreamerConfig(streamer);

  if (!config) {
    notFound();
  }

  return <StreamerShell config={config}>{children}</StreamerShell>;
}
