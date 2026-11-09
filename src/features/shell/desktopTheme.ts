'use client';

import { createTheme } from '@mui/material/styles';
import type {} from '@mui/material/themeCssVarsAugmentation';
import { effects, fonts, palette, type ThemeName } from '@/shared/design/tokens';

declare module '@mui/material/styles' {
  interface ColorSchemeOverrides { steel: true; sand: true }
}

function colorScheme(theme: ThemeName) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  const colors = palette[theme];
  // Custom schemes need a complete MUI palette, including common/action/grey defaults.
  return { palette: createTheme({ palette: {
    mode,
    primary: { main: colors.plot, dark: colors.plotHover, contrastText: colors.onEmphasis },
    warning: { main: colors.wait, dark: colors.wait, contrastText: colors.onEmphasis },
    success: { main: colors.live, dark: colors.liveHover, contrastText: colors.onEmphasis },
    error: { main: colors.stop, dark: colors.stop, contrastText: colors.onEmphasis },
    info: { main: colors.plot, dark: colors.plotHover, contrastText: colors.onEmphasis },
    background: { default: colors.shell, paper: colors.raised },
    text: { primary: colors.ink, secondary: colors.muted },
    divider: colors.line,
  } }).palette };
}

/** Appearance is stamped by our existing preference owner, including before React loads. */
export const desktopTheme = createTheme({
  cssVariables: { colorSchemeSelector: '[data-appearance=%s]' },
  colorSchemes: { light: colorScheme('light'), dark: colorScheme('dark'), steel: colorScheme('steel'), sand: colorScheme('sand') },
  typography: {
    fontFamily: fonts.sans,
    fontSize: 14,
    button: { textTransform: 'none', fontWeight: 600 },
    h6: { fontSize: '1.1rem', fontWeight: 600 },
    body2: { fontSize: '0.8125rem' },
    body1: { fontSize: '0.875rem', lineHeight: 1.6 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { size: 'small', variant: 'outlined', disableElevation: true }, styleOverrides: { root: { minWidth: 0, minHeight: 30, paddingInline: 10 }, outlined: { borderColor: 'var(--line-strong)' } } },
    MuiIconButton: { defaultProps: { size: 'small' }, styleOverrides: { root: { borderRadius: 8, '&.Mui-focusVisible': { outlineOffset: -2 } } } },
    MuiNativeSelect: { styleOverrides: { select: { '&:focus-visible': { outline: '2px solid var(--focus-color)', outlineOffset: 2 } } } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiCheckbox: { defaultProps: { size: 'small' } },
    MuiSwitch: { defaultProps: { size: 'small' } },
    MuiChip: { defaultProps: { size: 'small' } },
    MuiTabs: { styleOverrides: { root: { minHeight: 32 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 32, padding: '6px 10px', textTransform: 'none', minWidth: 0, '&.Mui-focusVisible': { outlineOffset: -3 } } } },
    MuiMenuItem: { defaultProps: { dense: true } },
    MuiToggleButton: { defaultProps: { size: 'small' }, styleOverrides: { root: { padding: '5px 8px', textTransform: 'none' } } },
    MuiAlert: { styleOverrides: { root: { color: 'var(--ink)', backgroundColor: 'var(--raised)', border: '1px solid var(--line)' }, message: { minWidth: 0, flex: 1 }, icon: { '& svg': { width: 22, height: 22 }, '&.MuiAlert-icon': { paddingTop: 4 } } } },
    MuiPaper: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiDialogActions: { defaultProps: { disableSpacing: true }, styleOverrides: { root: { flexWrap: 'wrap', gap: 8 } } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: 'sm' } },
    MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: '2px solid var(--focus-color)', outlineOffset: 2 } } } },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: effects.light.modalBackdrop } } },
  },
});
