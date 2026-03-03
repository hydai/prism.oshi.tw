import fs from 'fs';
import path from 'path';
import { Registry, StreamerConfig } from './types';

const registryPath = path.join(process.cwd(), 'data', 'registry.json');

export function getRegistry(): Registry {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  return JSON.parse(raw) as Registry;
}

export function getStreamerConfig(slug: string): StreamerConfig | undefined {
  const registry = getRegistry();
  return registry.streamers.find(s => s.slug === slug && s.enabled);
}

export function getAllStreamerSlugs(): string[] {
  const registry = getRegistry();
  return registry.streamers.filter(s => s.enabled).map(s => s.slug);
}
