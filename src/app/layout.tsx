import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { DesktopThemeProvider } from '@/features/shell/DesktopThemeProvider';
import { appearanceScript } from '@/shared/design/appearance';
import './globals.css';

// Generated local(Arial) fallback faces reject document.fonts.load on hosts without Arial.
// Keep the explicit fallback stacks used by desktop and immersive font loading.
const geist = localFont({
  src: './fonts/Geist.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  adjustFontFallback: false,
  variable: '--font-geist',
  fallback: ['system-ui', 'Arial'],
});

const geistMono = localFont({
  src: './fonts/GeistMono.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  adjustFontFallback: false,
  variable: '--font-geist-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas'],
});

const archivo = localFont({
  src: './fonts/Archivo.woff2',
  weight: '100 900',
  style: 'normal',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
  display: 'swap',
  adjustFontFallback: false,
  variable: '--font-archivo',
  fallback: ['Arial', 'system-ui'],
});

const inter = localFont({
  src: './fonts/Inter.woff2',
  weight: '400 600',
  style: 'normal',
  display: 'swap',
  adjustFontFallback: false,
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
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${archivo.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body><AppRouterCacheProvider><DesktopThemeProvider>{children}</DesktopThemeProvider></AppRouterCacheProvider></body>
    </html>
  );
}
