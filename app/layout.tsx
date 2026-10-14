import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Aetheris Computer | Chat',
  description:
    'Aetheris is a mobile-first AI chat experience with streaming responses, markdown, and model switching.',
  manifest: '/manifest.json',
  metadataBase: new URL('https://www.aetherisai.me'),
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Aetheris'
  },
  openGraph: {
    title: 'Aetheris Computer | Chat',
    description:
      'Aetheris is a mobile-first AI chat experience with streaming responses, markdown, and photo understanding.',
    url: '/',
    siteName: 'Aetheris',
    type: 'website',
    images: [
      {
        url: '/aetheris-email.png',
        width: 480,
        height: 480,
        alt: 'Aetheris logo'
      }
    ]
  },
  twitter: {
    card: 'summary',
    title: 'Aetheris Computer | Chat',
    description:
      'Aetheris is a mobile-first AI chat experience with streaming responses, markdown, and photo understanding.'
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
