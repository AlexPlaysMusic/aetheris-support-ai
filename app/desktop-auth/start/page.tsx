'use client';

import { useCallback, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { LoaderCircle } from 'lucide-react';

export default function DesktopAuthStartPage() {
  const started = useRef(false);

  const beginSignIn = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void signIn('google', { callbackUrl: '/api/auth/desktop/complete' });
  }, []);

  useEffect(() => {
    beginSignIn();
  }, [beginSignIn]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-abyss px-6 text-center">
      <div className="max-w-sm">
        <img
          src="/aetheris-portal.png"
          alt=""
          width={64}
          height={64}
          className="mx-auto rounded-2xl"
        />
        <h1 className="mt-5 text-xl font-semibold text-white">Continue to Aetheris</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Google sign-in is opening in your browser. After you approve access, Aetheris AI will finish signing you in.
        </p>
        <button
          type="button"
          onClick={beginSignIn}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
        >
          <LoaderCircle size={16} className="animate-spin" />
          Continue with Google
        </button>
      </div>
    </main>
  );
}
