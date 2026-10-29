'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import HeaderBrand from '../../components/Header';

export default function BillingSuccessPage() {
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId) {
      setError('Missing checkout session.');
      setState('error');
      return;
    }
    void fetch('/api/billing/stripe/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (!r.ok) {
          throw new Error(
            (d && typeof d['error'] === 'string' && d['error']) ||
              'Payment could not be confirmed.'
          );
        }
        setState('done');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Confirmation failed.');
        setState('error');
      });
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-abyss text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-abyss/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3">
          <a href="/" aria-label="Back to Aetheris">
            <HeaderBrand size={40} />
          </a>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 text-center">
        {state === 'working' && (
          <>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
            <p className="mt-4 text-[14px] text-slate-300">Confirming your payment…</p>
          </>
        )}
        {state === 'done' && (
          <>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15">
              <Check size={26} className="text-emerald-300" />
            </span>
            <h1 className="mt-4 text-xl font-bold text-white">Welcome to Pro</h1>
            <p className="mt-2 text-[14px] leading-6 text-slate-400">
              Your membership is active. Pick your plan in the model switcher
              and enjoy.
            </p>
            <a
              href="/"
              className="mt-6 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#06121a] transition hover:bg-cyan-300"
            >
              Start chatting
            </a>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="text-xl font-bold text-white">Hmm, that didn&apos;t confirm</h1>
            <p className="mt-2 text-[14px] leading-6 text-slate-400">
              {error ?? 'The payment could not be confirmed.'} If you were
              charged, it will resolve — otherwise try again from the upgrade
              dialog.
            </p>
            <a
              href="/"
              className="mt-6 rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-white/25"
            >
              Back to Aetheris
            </a>
          </>
        )}
      </main>
    </div>
  );
}
