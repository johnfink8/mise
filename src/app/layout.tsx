import './globals.css';
import Link from 'next/link';

export const metadata = { title: 'mise' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <h1>
              <Link href="/">mise</Link>
            </h1>
            <nav>
              <Link href="/">New</Link>
              <Link href="/history">History</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
