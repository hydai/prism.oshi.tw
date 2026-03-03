'use client';

import { createContext, useContext, ReactNode } from 'react';

interface FanAuthContextType {
  isLoggedIn: false;
  isLoading: false;
}

const FanAuthContext = createContext<FanAuthContextType>({
  isLoggedIn: false,
  isLoading: false,
});

export const useFanAuth = () => useContext(FanAuthContext);

export const FanAuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <FanAuthContext.Provider value={{ isLoggedIn: false, isLoading: false }}>
      {children}
    </FanAuthContext.Provider>
  );
};
