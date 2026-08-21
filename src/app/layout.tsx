import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeAI — conversational code canvas',
  description: 'Explore a local repository with a read-only coding agent and Mermaid canvas.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
