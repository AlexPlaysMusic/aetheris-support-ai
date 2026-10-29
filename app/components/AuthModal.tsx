'use client';

import { useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { ArrowLeft, LoaderCircle, Mail, X } from 'lucide-react';

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { update } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not send your code.');
      setCodeSent(true);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send your code.');
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
        redirect: false
      });
      if (!result?.ok) {
        throw new Error(
          result?.error === 'CredentialsSignin'
            ? 'That code is invalid or expired. Request a new one and try again.'
            : 'Could not verify your code. Please try again.'
        );
      }
      await update();
      onClose();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not verify your code.');
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = () => {
    const isDesktop = /electron\//i.test(navigator.userAgent);
    if (isDesktop) {
      window.location.assign('/desktop-auth/start');
    } else {
      void signIn('google', { callbackUrl: '/' });
    }
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-dialog-title"
      onClick={onClose}
    >
      <div
        className="animate-pop w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/aetheris-portal.png"
              alt=""
              width={42}
              height={42}
              className="rounded-xl"
            />
            <div>
              <h2 id="auth-dialog-title" className="text-lg font-semibold text-white">
                Sign in to Aetheris
              </h2>
              <p className="text-sm text-slate-400">Save your chats and projects.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign-in"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:opacity-60"
        >
          <span className="text-lg font-bold text-[#4285F4]" aria-hidden="true">G</span>
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs uppercase tracking-wider text-slate-500">or email</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={verifyCode} className="space-y-3">
          <label htmlFor="auth-email" className="block text-sm font-medium text-slate-200">
            Email address
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={codeSent || busy}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
          />

          {codeSent && (
            <>
              <label htmlFor="auth-code" className="block pt-1 text-sm font-medium text-slate-200">
                Six-digit verification code
              </label>
              <input
                id="auth-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
              />
              <p className="text-xs leading-5 text-slate-500">
                We sent a code to <span className="text-slate-300">{email}</span>. It expires in 10 minutes.
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          {!codeSent ? (
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy || email.trim() === ''}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Mail size={16} />}
              Email me a sign-in code
            </button>
          ) : (
            <div className="space-y-2">
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <LoaderCircle size={16} className="animate-spin" />}
                Verify and sign in
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCodeSent(false);
                    setCode('');
                    setError(null);
                  }}
                  className="flex items-center gap-1 text-slate-400 transition hover:text-white"
                >
                  <ArrowLeft size={13} /> Change email
                </button>
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={busy}
                  className="text-cyan-200 transition hover:text-white disabled:opacity-50"
                >
                  Send a new code
                </button>
              </div>
            </div>
          )}
        </form>

        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
          By signing in, you agree to Aetheris&apos; terms and privacy policy.
        </p>
      </div>
    </div>
  );
}
