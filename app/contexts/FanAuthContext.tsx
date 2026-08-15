'use client';

import { createContext, ReactNode } from 'react';

interface FanAuthContextType {
  isLoggedIn: false;
  isLoading: false;
}

const FAN_AUTH_VALUE: FanAuthContextType = {
  isLoggedIn: false,
  isLoading: false,
};

const FanAuthContext = createContext<FanAuthContextType>(FAN_AUTH_VALUE);

export const FanAuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <FanAuthContext.Provider value={FAN_AUTH_VALUE}>
      {children}
    </FanAuthContext.Provider>
  );
};
