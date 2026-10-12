'use client';

export default function ChatError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-abyss px-6 text-center">
      <p className="text-lg font-semibold text-white">Something went wrong</p>
      <p className="max-w-sm text-[13px] leading-6 text-slate-400">
        {error?.message || 'The chat UI hit an unexpected error.'}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#06121a] transition hover:bg-cyan-300"
      >
        Try again
      </button>
    </div>
  );
}
