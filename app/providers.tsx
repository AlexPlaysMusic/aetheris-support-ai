'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  /* register the service worker once (enables installable-app checks) */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline or unsupported — the app works without it */
      });
    }
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
