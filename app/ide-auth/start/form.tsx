'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { LoaderCircle, Mail } from 'lucide-react';

export default function IdeAuthForm({ state }: { state: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackUrl = `/api/ide-auth/complete?state=${encodeURIComponent(state)}`;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not send sign-in code.');
      setCodeSent(true);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send sign-in code.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn('email-code', {
        email,
        code,
        redirect: false,
        callbackUrl
      });
      if (!result?.ok) throw new Error('That sign-in code is invalid or expired.');
      window.location.assign(callbackUrl);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-abyss px-5 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <img src="/aetheris-portal.png" alt="" width={44} height={44} className="rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold text-white">Sign in to Aetheris for VS Code</h1>
            <p className="mt-1 text-sm text-slate-400">Your sign-in will return you to the extension.</p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signIn('google', { callbackUrl })}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-60"
        >
          <span className="text-lg font-bold text-[#4285F4]" aria-hidden="true">G</span>
          Continue with Google
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-white/10" />OR<span className="h-px flex-1 bg-white/10" />
        </div>
        {!codeSent ? (
          <div className="flex gap-2">
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              aria-label="Email address"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50"
            />
            <button
              type="button"
              disabled={busy || email.trim() === ''}
              onClick={() => void sendCode()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-white disabled:opacity-50"
            >
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Mail size={15} />}
              Send code
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void verifyCode(event)} className="space-y-3">
            <p className="text-sm text-slate-300">Enter the 6-digit code sent to {email}.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="000000"
              aria-label="Email sign-in code"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-cyan-300/50"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Verify and return to VS Code'}
            </button>
          </form>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        <p className="mt-5 text-xs leading-5 text-slate-500">
          VS Code receives a revocable sign-in token. Your Google password and email code are never shared with the extension.
        </p>
      </section>
    </main>
  );
}
