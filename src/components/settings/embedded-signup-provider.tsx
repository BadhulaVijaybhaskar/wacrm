'use client';
import { createContext, useContext, type ReactNode } from 'react';

const EmbeddedSignupEnabled = createContext(false);
export function EmbeddedSignupProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <EmbeddedSignupEnabled.Provider value={enabled}>{children}</EmbeddedSignupEnabled.Provider>;
}
export function useEmbeddedSignupEnabled() {
  return useContext(EmbeddedSignupEnabled);
}
