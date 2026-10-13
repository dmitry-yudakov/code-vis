import type { Metadata, Viewport } from 'next';
import { Archivo, Geist, Geist_Mono, Inter } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { DesktopThemeProvider } from '@/features/shell/DesktopThemeProvider';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
  fallback: ['system-ui', 'Arial'],
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas'],
});

const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
  fallback: ['Arial', 'system-ui'],
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-inter',
  fallback: ['system-ui', 'Arial'],
});

export const metadata: Metadata = {
  title: 'CodeAI — conversational code canvas',
  description: 'Explore a local repository with a read-only coding agent and Mermaid canvas.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

const themeScript = `(function(){var r=document.documentElement;var t="system";try{t=localStorage.getItem("code-ai:theme")}catch(e){}if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else{t="system";r.removeAttribute("data-theme")}r.setAttribute("data-appearance",t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t)})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${archivo.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><AppRouterCacheProvider><DesktopThemeProvider>{children}</DesktopThemeProvider></AppRouterCacheProvider></body>
    </html>
  );
}
