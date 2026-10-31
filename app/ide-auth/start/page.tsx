import IdeAuthForm from './form';

export default function IdeAuthStartPage({
  searchParams
}: {
  searchParams: { state?: string };
}) {
  const state = searchParams.state ?? '';
  if (!/^[a-f0-9]{64}$/.test(state)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-abyss px-6 text-center text-slate-100">
        <p>This VS Code sign-in link is invalid. Return to VS Code and try again.</p>
      </main>
    );
  }
  return <IdeAuthForm state={state} />;
}
