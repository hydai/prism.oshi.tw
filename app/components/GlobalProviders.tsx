'use client';

import { ReactNode } from 'react';
import { FanAuthProvider } from '../contexts/FanAuthContext';

export default function GlobalProviders({ children }: { children: ReactNode }) {
  return (
    <FanAuthProvider>
      {children}
    </FanAuthProvider>
  );
}
