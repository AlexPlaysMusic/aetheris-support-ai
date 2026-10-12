import type { Metadata } from 'next';
import HeaderBrand from '../components/Header';

export const metadata: Metadata = {
  title: 'Terms of Service | Aetheris',
  description: 'The rules for using Aetheris.'
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[16px] font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] leading-7 text-slate-300">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-[100dvh] bg-abyss text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-abyss/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3">
          <a href="/" aria-label="Back to Aetheris">
            <HeaderBrand size={24} />
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Terms of Service
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">Last updated October 2026.</p>

        <Section title="The service">
          <p>
            Aetheris is an AI chat app provided as-is. AI replies can be wrong,
            incomplete, or outdated — verify anything important before acting on it.
          </p>
        </Section>

        <Section title="Fair use">
          <ul className="list-disc space-y-1 pl-5">
            <li>Daily credits reset at midnight. Don&apos;t game the counters.</li>
            <li>
              Don&apos;t use the service for anything illegal, to harm others, or
              to probe, overload, or reverse-engineer the service.
            </li>
            <li>One account per person. Don&apos;t share accounts or API access.</li>
          </ul>
        </Section>

        <Section title="Your content">
          <p>
            Your prompts and files remain yours. By sending them you allow us to
            process them to operate the service (including via our AI provider).
            Shared chat links are your responsibility — anyone with the link can
            read that conversation.
          </p>
        </Section>

        <Section title="Accounts">
          <p>
            Signing in is optional. We may suspend accounts that abuse the
            service. You can stop using Aetheris any time; clearing site data
            removes locally stored chats.
          </p>
        </Section>

        <Section title="Liability">
          <p>
            To the maximum extent permitted by law, Aetheris is provided without
            warranties, and we aren&apos;t liable for actions you take based on AI
            replies or for interruptions to the service.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update these terms as the service evolves; material changes
            will be noted here with a new date.
          </p>
        </Section>
      </main>
    </div>
  );
}
