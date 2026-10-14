import type { Metadata } from 'next';
import HeaderBrand from '../components/Header';

export const metadata: Metadata = {
  title: 'Privacy Policy | Aetheris',
  description: 'How Aetheris handles your data.'
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

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">Last updated October 2026.</p>

        <Section title="The short version">
          <p>
            Your chats stay in <strong className="text-slate-100">your browser</strong> unless
            you share them. We never sell your data. Signing in is optional —
            guests can chat with a smaller daily allowance.
          </p>
        </Section>

        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-slate-100">In your browser:</strong> chat history,
              preferences, and your credit balance (localStorage). Clearing site
              data erases them.
            </li>
            <li>
              <strong className="text-slate-100">On our servers:</strong> a daily counter
              of credits used (keyed by account id, or IP address for guests) to
              enforce fair-use limits. Counters expire automatically.
            </li>
            <li>
              <strong className="text-slate-100">If you join the Pro waitlist:</strong> your
              email address, used only to contact you about Pro.
            </li>
          </ul>
        </Section>

        <Section title="Sign-in with Google">
          <p>
            If you sign in, Google shares your name, email address, and profile
            photo so we can show your profile and keep per-account history and
            credits. We use nothing else from your Google account. Signing out
            keeps your stored chats on that device until you clear them.
          </p>
        </Section>

        <Section title="Messages and files">
          <p>
            Your prompts, photos, and attached files are sent to our AI providers
            (Google Gemini for chat, Pollinations for generated images) to
            generate replies, and are processed under their policies.
            Automated safety filters block sexual and explicit content.
            Don&apos;t send anything you wouldn&apos;t want processed —
            especially passwords, ID documents, or other people&apos;s private data.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We use a strictly necessary session cookie to keep you signed in.
            No advertising or cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Shared chats">
          <p>
            Share links embed the conversation in the link itself — anyone with
            the link can read it. Only share chats you&apos;re comfortable making
            semi-public.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy: open Help &amp; Support in the app
            menu and our AI support will email you back.
          </p>
        </Section>
      </main>
    </div>
  );
}
