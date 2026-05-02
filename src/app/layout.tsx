import { Instrument_Serif, Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

export const metadata = { title: 'mise' };

// next/font self-hosts these — they ship from /static and are loaded with the
// initial HTML response, eliminating the font-swap flash. The `variable`
// option exposes each as a CSS custom property the @theme block in
// globals.css picks up.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--mise-font-inter',
});
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--mise-font-instrument-serif',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--mise-font-jetbrains-mono',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--mise-font-space-grotesk',
});

const fontVariables = [
  inter.variable,
  instrumentSerif.variable,
  jetbrainsMono.variable,
  spaceGrotesk.variable,
].join(' ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <div className="flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
