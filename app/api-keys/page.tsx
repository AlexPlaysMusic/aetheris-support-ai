'use client';

import { useCallback, useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { ArrowLeft, Check, Copy, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';

type ApiKeyItem = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: string | null;
};

export default function ApiKeysPage() {
  const { status } = useSession();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [label, setLabel] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/keys', { cache: 'no-store' });
      const data = (await response.json()) as {
        keys?: ApiKeyItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? 'Could not load API keys.');
      setKeys(Array.isArray(data.keys) ? data.keys : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void loadKeys();
    else if (status === 'unauthenticated') setLoading(false);
  }, [status, loadKeys]);

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNewKey(null);
    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
      const data = (await response.json()) as {
        key?: string;
        error?: string;
      };
      if (!response.ok || typeof data.key !== 'string') {
        throw new Error(data.error ?? 'Could not create the API key.');
      }
      setNewKey(data.key);
      setLabel('');
      await loadKeys();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the API key.');
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not revoke the API key.');
      await loadKeys();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke the API key.');
    } finally {
      setBusy(false);
    }
  };

  const copyNewKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch (copyError) {
      console.error('[aetheris/api-keys] clipboard copy failed:', copyError);
      setError('Copy was blocked. Select the key and copy it manually.');
    }
  };

  return (
    <main className="min-h-screen bg-abyss px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft size={16} /> Back to Aetheris
        </a>
        <div className="mt-7 flex items-center gap-3">
          <KeyRound className="text-cyan-300" size={24} />
          <div>
            <h1 className="text-2xl font-semibold text-white">Aetheris API keys</h1>
            <p className="mt-1 text-sm text-slate-400">
              Create and revoke keys for the Aetheris developer API.
            </p>
          </div>
        </div>

        {status === 'unauthenticated' ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-surface p-5">
            <p className="text-sm text-slate-300">Sign in to manage your API keys.</p>
            <button
              type="button"
              onClick={() => void signIn('google', { callbackUrl: '/api-keys' })}
              className="mt-4 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Sign in
            </button>
          </div>
        ) : (
          <>
            <form
              onSubmit={(event) => void createKey(event)}
              className="mt-6 flex flex-col gap-3 rounded-xl border border-white/10 bg-surface p-4 sm:flex-row"
            >
              <input
                aria-label="API key label"
                required
                maxLength={80}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Key label, e.g. My integration"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
              />
              <button
                type="submit"
                disabled={busy || label.trim() === ''}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
                Create key
              </button>
            </form>

            {newKey && (
              <section className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4">
                <h2 className="text-sm font-semibold text-amber-100">Copy your new API key now</h2>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  It is shown only once. Store it in a server-side secret manager, never in browser code.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    aria-label="New Aetheris API key"
                    readOnly
                    value={newKey}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-amber-100"
                  />
                  <button
                    type="button"
                    onClick={() => void copyNewKey()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-white"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </section>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <section className="mt-6 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Your keys</h2>
              {loading ? (
                <p className="text-sm text-slate-500">Loading keys…</p>
              ) : keys.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-surface p-4 text-sm text-slate-400">
                  No API keys yet.
                </p>
              ) : (
                keys.map((item) => (
                  <article key={item.id} className="rounded-xl border border-white/10 bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-white">{item.label}</h3>
                          {item.revokedAt && (
                            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
                              Revoked
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-400">{item.prefix}…</p>
                        <p className="mt-2 text-xs text-slate-500">
                          Created {new Date(item.createdAt).toLocaleDateString()} · {item.requestCount} requests · {item.promptTokens + item.completionTokens} tokens
                        </p>
                      </div>
                      {!item.revokedAt && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revokeKey(item.id)}
                          aria-label={`Revoke ${item.label}`}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
