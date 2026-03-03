import { NextResponse } from 'next/server';
import { getRegistry } from '@/lib/registry';

export const dynamic = 'force-static';

export async function GET() {
  const registry = getRegistry();
  return NextResponse.json(registry);
}
