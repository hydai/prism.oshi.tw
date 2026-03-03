'use client';

import { createContext, useContext, ReactNode } from 'react';
import { StreamerConfig } from '../../lib/types';

const StreamerContext = createContext<StreamerConfig | undefined>(undefined);

export const useStreamer = () => {
  const context = useContext(StreamerContext);
  if (!context) {
    throw new Error('useStreamer must be used within a StreamerProvider');
  }
  return context;
};

export const StreamerProvider = ({
  config,
  children,
}: {
  config: StreamerConfig;
  children: ReactNode;
}) => {
  return (
    <StreamerContext.Provider value={config}>
      {children}
    </StreamerContext.Provider>
  );
};
