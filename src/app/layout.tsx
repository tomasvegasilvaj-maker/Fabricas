import type { Metadata, Viewport } from 'next';
import { Familjen_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const display = Familjen_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: 'Fábrica de Placas', template: '%s · Fábrica de Placas' },
  description: 'Fábrica de placas NFC + QR con agentes de IA.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
