'use client';

import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { desktopTheme } from './desktopTheme';
import { AppearanceContext, useAppearanceOwner } from './useTheme';

export function DesktopThemeProvider({ children }: { children: React.ReactNode }) {
  const appearance = useAppearanceOwner();
  return <AppearanceContext.Provider value={appearance}>
    <ThemeProvider theme={desktopTheme} colorSchemeNode={null} storageManager={null}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  </AppearanceContext.Provider>;
}
