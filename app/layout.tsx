import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Aetheris Computer | AI Workspace',
  description:
    'A desktop AI workspace for research, writing, project files, and verified answers.',
  manifest: '/manifest.json',
  metadataBase: new URL('https://www.aetherisai.me'),
  icons: {
    icon: '/icon-512.png',
    apple: '/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Aetheris'
  },
  openGraph: {
    title: 'Aetheris Computer | AI Workspace',
    description:
      'A desktop AI workspace for research, writing, project files, and verified answers.',
    url: '/',
    siteName: 'Aetheris',
    type: 'website',
    images: [
      {
        url: '/aetheris-portal.png',
        width: 480,
        height: 480,
        alt: 'Aetheris Computer portal logo'
      }
    ]
  },
  twitter: {
    card: 'summary',
    title: 'Aetheris Computer | AI Workspace',
    description:
      'A desktop AI workspace for research, writing, project files, and verified answers.',
    images: ['/aetheris-portal.png']
  }
};

export const viewport: Viewport = {
  themeColor: '#05050A',
  width: 1024,
  initialScale: 1
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
