import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Aetheris AI | Chat',
  description:
    'Aetheris is a mobile-first AI chat experience with streaming responses, markdown, and model switching.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg'
  }
};

export const viewport: Viewport = {
  themeColor: '#0B0F17',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-abyss text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
