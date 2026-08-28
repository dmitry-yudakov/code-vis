import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeAI — conversational code canvas',
  description: 'Explore a local repository with a read-only coding agent and Mermaid canvas.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

const themeScript = `(function(){try{var t=localStorage.getItem("code-ai:theme");var r=document.documentElement;if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else r.removeAttribute("data-theme")}catch(e){document.documentElement.removeAttribute("data-theme")}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
