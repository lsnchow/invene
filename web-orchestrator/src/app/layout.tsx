import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Invene',
  description: 'Autonomous code execution',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={mono.className}>{children}</body>
    </html>
  );
}
