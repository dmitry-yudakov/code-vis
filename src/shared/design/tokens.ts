export type ThemeName = 'light' | 'dark';

type CoreColorToken =
  | 'sheet'
  | 'shell'
  | 'shellSunk'
  | 'raised'
  | 'ink'
  | 'ink2'
  | 'muted'
  | 'faint'
  | 'line'
  | 'lineStrong'
  | 'live'
  | 'liveWash'
  | 'wait'
  | 'waitWash'
  | 'stop'
  | 'stopWash'
  | 'plot'
  | 'plotWash'
  | 'add'
  | 'addWash'
  | 'del'
  | 'delWash'
  | 'grid';

type DetailColorToken =
  | 'sheetSunk'
  | 'onEmphasis'
  | 'absoluteWhite'
  | 'selectedWash'
  | 'idle'
  | 'liveInk'
  | 'liveInkStrong'
  | 'liveInkDeep'
  | 'liveInkMuted'
  | 'liveInkSoft'
  | 'liveHover'
  | 'liveLine'
  | 'addMuted'
  | 'untracked'
  | 'untrackedWash'
  | 'plotBright'
  | 'plotLine'
  | 'plotLineSoft'
  | 'plotLineMuted'
  | 'plotInk'
  | 'plotInkMuted'
  | 'plotInkDeep'
  | 'plotHover'
  | 'plotWashSoft'
  | 'plotWashMuted'
  // Diagram section fills. Mermaid's mindmap, pie, journey and quadrant renderers colour their
  // sections from cScale0…n rather than from primaryColor, and the base theme derives those by
  // hue-rotating the primary — which lands on magenta and purple. This is the ramp they use
  // instead: one hue, five steps, every one of them readable under `ink`.
  | 'plotScale1'
  | 'plotScale2'
  | 'plotScale3'
  | 'plotScale4'
  | 'plotScale5'
  | 'waitLine'
  | 'waitLineStrong'
  | 'waitInkMuted'
  | 'waitInkStrong'
  | 'waitWashMuted'
  | 'cancelWash'
  | 'cancelLine'
  | 'errorLine'
  | 'stopLine'
  | 'stopInk'
  | 'stopWashStrong'
  | 'controlWash'
  | 'inlineCodeSurface'
  | 'codeSurface'
  | 'codeInk'
  | 'neutralWash'
  | 'neutralWashRaised'
  | 'neutralWashStrong'
  | 'neutralWashDeep'
  | 'diffSurface'
  | 'diffMeta'
  | 'hunk'
  | 'hunkWash'
  | 'delStrong'
  | 'placeholder';

export type ColorToken = CoreColorToken | DetailColorToken;

export type EffectToken =
  | 'shadow'
  | 'focusColor'
  | 'headerBackdrop'
  | 'onEmphasisBorder'
  | 'popoverShadow'
  | 'focusWash'
  | 'headerControlBackdrop'
  | 'liveHalo'
  | 'sheetBackdrop'
  | 'lineBackdrop'
  | 'canvasVignette'
  | 'floatingBackdrop'
  | 'componentShadow'
  | 'focusWashStrong'
  | 'plotControlWash'
  | 'liveShadow'
  | 'plotHalo'
  | 'plotHaloSoft'
  | 'subtleRaisedBackdrop'
  | 'sketchGrid'
  | 'sketchShadow'
  | 'sheetErrorBackdrop'
  | 'drawerShadow'
  | 'raisedBackdrop'
  | 'plotInset'
  | 'raisedBackdropSoft'
  | 'raisedBackdropMedium'
  | 'permissionShadow'
  | 'raisedBackdropStrong'
  | 'waitBackdrop'
  | 'diagramLabelBackdrop'
  | 'canvasGridSoft'
  | 'plotOrbit'
  | 'plotOrbitInner'
  | 'onEmphasisWash'
  | 'sidebarShadow'
  | 'sidebarInspectorShadow'
  | 'raisedBackdropButton'
  | 'raisedBackdropBadge';

const light = {
  sheet: '#ffffff',
  shell: '#f4f6f8',
  shellSunk: '#eceff3',
  raised: '#ffffff',
  ink: '#0f1319',
  ink2: '#3c4453',
  muted: '#657084',
  faint: '#939cad',
  line: '#e1e6ec',
  lineStrong: '#cdd4de',
  live: '#12795c',
  liveWash: '#e6f4ef',
  wait: '#a8620a',
  waitWash: '#fdf1e0',
  stop: '#be3227',
  stopWash: '#fdeceb',
  plot: '#2f5ad0',
  plotWash: '#eaf0fd',
  add: '#1a7a4c',
  addWash: '#e8f5ee',
  del: '#b8332a',
  delWash: '#fceeed',
  grid: 'rgba(15, 19, 25, .055)',
  sheetSunk: '#f4f6f8',
  onEmphasis: '#ffffff',
  absoluteWhite: '#fff',
  selectedWash: '#eaf0fd',
  idle: '#939cad',
  liveInk: '#12795c',
  liveInkStrong: '#0f694f',
  liveInkDeep: '#0d6049',
  liveInkMuted: '#176b55',
  liveInkSoft: '#24705c',
  liveHover: '#0e684f',
  liveLine: '#a8d7c8',
  addMuted: '#176b45',
  untracked: '#657084',
  untrackedWash: '#eceff3',
  plotBright: '#2f5ad0',
  plotLine: '#9db2ec',
  plotLineSoft: '#c5d2f4',
  plotLineMuted: '#afbfec',
  plotInk: '#2f5ad0',
  plotInkMuted: '#3658b6',
  plotInkDeep: '#2448aa',
  plotHover: '#2449b5',
  plotWashSoft: '#f2f5fd',
  plotWashMuted: '#eaf0fd',
  plotScale1: '#eaf0fd',
  plotScale2: '#d8e3fa',
  plotScale3: '#c5d2f4',
  plotScale4: '#afbfec',
  plotScale5: '#9db2ec',
  waitLine: '#e4bd85',
  waitLineStrong: '#d49b4d',
  waitInkMuted: '#80531b',
  waitInkStrong: '#965300',
  waitWashMuted: '#f8e4c7',
  cancelWash: '#fdeceb',
  cancelLine: '#e7a49f',
  errorLine: '#dc8f89',
  stopLine: '#e7a49f',
  stopInk: '#9e281f',
  stopWashStrong: '#f8d5d2',
  controlWash: '#eceff3',
  inlineCodeSurface: '#eceff3',
  codeSurface: '#171c24',
  codeInk: '#e8ecf3',
  neutralWash: '#f4f6f8',
  neutralWashRaised: '#ffffff',
  neutralWashStrong: '#eceff3',
  neutralWashDeep: '#e1e6ec',
  diffSurface: '#f8f9fb',
  diffMeta: '#657084',
  hunk: '#5b4cb5',
  hunkWash: '#f0edfb',
  delStrong: '#a82d25',
  placeholder: '#7c8799',
} satisfies Record<ColorToken, string>;

const darkCore = {
  sheet: '#151920',
  shell: '#0a0c10',
  shellSunk: '#06080b',
  raised: '#171c24',
  ink: '#e8ecf3',
  ink2: '#b9c2d0',
  muted: '#8a94a6',
  faint: '#616b7d',
  line: '#222831',
  lineStrong: '#333b47',
  live: '#3fbf95',
  liveWash: '#10261f',
  wait: '#e0a252',
  waitWash: '#2a1e0f',
  stop: '#f0776b',
  stopWash: '#2b1412',
  plot: '#7d9df5',
  plotWash: '#131c33',
  add: '#45b57c',
  addWash: '#10231a',
  del: '#ef7a70',
  delWash: '#2a1513',
  grid: 'rgba(232, 236, 243, .06)',
} satisfies Record<CoreColorToken, string>;

const dark = {
  ...darkCore,
  sheetSunk: darkCore.shell,
  onEmphasis: darkCore.shell,
  absoluteWhite: light.absoluteWhite,
  selectedWash: darkCore.plotWash,
  idle: darkCore.faint,
  liveInk: darkCore.live,
  liveInkStrong: darkCore.live,
  liveInkDeep: darkCore.live,
  liveInkMuted: darkCore.live,
  liveInkSoft: darkCore.live,
  liveHover: darkCore.live,
  liveLine: darkCore.lineStrong,
  addMuted: darkCore.add,
  untracked: darkCore.muted,
  untrackedWash: darkCore.shellSunk,
  plotBright: darkCore.plot,
  plotLine: darkCore.plot,
  plotLineSoft: darkCore.plot,
  plotLineMuted: darkCore.plot,
  plotInk: darkCore.plot,
  plotInkMuted: darkCore.plot,
  plotInkDeep: darkCore.plot,
  plotHover: darkCore.plot,
  plotWashSoft: darkCore.plotWash,
  plotWashMuted: darkCore.plotWash,
  plotScale1: darkCore.plotWash,
  plotScale2: '#1b2745',
  plotScale3: '#243358',
  plotScale4: '#2e406c',
  plotScale5: '#394d80',
  waitLine: darkCore.wait,
  waitLineStrong: darkCore.wait,
  waitInkMuted: darkCore.wait,
  waitInkStrong: darkCore.wait,
  waitWashMuted: darkCore.waitWash,
  cancelWash: darkCore.stopWash,
  cancelLine: darkCore.stop,
  errorLine: darkCore.stop,
  stopLine: darkCore.stop,
  stopInk: darkCore.stop,
  stopWashStrong: darkCore.stopWash,
  controlWash: darkCore.shellSunk,
  inlineCodeSurface: darkCore.shellSunk,
  codeSurface: darkCore.shellSunk,
  codeInk: darkCore.ink,
  neutralWash: darkCore.shell,
  neutralWashRaised: darkCore.raised,
  neutralWashStrong: darkCore.shellSunk,
  neutralWashDeep: darkCore.shellSunk,
  diffSurface: darkCore.raised,
  diffMeta: darkCore.muted,
  hunk: darkCore.plot,
  hunkWash: darkCore.plotWash,
  delStrong: darkCore.del,
  placeholder: darkCore.faint,
} satisfies Record<ColorToken, string>;

export const palette: Record<ThemeName, Record<ColorToken, string>> = { light, dark };

export const effects: Record<ThemeName, Record<EffectToken, string>> = {
  light: {
    shadow: '0 1px 2px rgba(15, 19, 25, .05), 0 8px 24px rgba(15, 19, 25, .07)',
    focusColor: '#2f5ad0',
    headerBackdrop: 'rgba(244, 246, 248, .96)',
    onEmphasisBorder: 'rgba(255, 255, 255, .18)',
    popoverShadow: '0 2px 4px rgba(15, 19, 25, .05), 0 18px 48px rgba(15, 19, 25, .12)',
    focusWash: 'rgba(47, 90, 208, .1)',
    headerControlBackdrop: 'rgba(255, 255, 255, .7)',
    liveHalo: 'rgba(18, 121, 92, .14)',
    sheetBackdrop: 'rgba(255, 255, 255, .9)',
    lineBackdrop: 'rgba(225, 230, 236, .85)',
    canvasVignette: 'rgba(15, 19, 25, .035)',
    floatingBackdrop: 'rgba(255, 255, 255, .96)',
    componentShadow: 'rgba(15, 19, 25, .07)',
    focusWashStrong: 'rgba(47, 90, 208, .13)',
    plotControlWash: 'rgba(47, 90, 208, .12)',
    liveShadow: 'rgba(18, 121, 92, .2)',
    plotHalo: 'rgba(47, 90, 208, .08)',
    plotHaloSoft: 'rgba(47, 90, 208, .035)',
    subtleRaisedBackdrop: 'rgba(255, 255, 255, .76)',
    sketchGrid: 'rgba(15, 19, 25, .055)',
    sketchShadow: 'rgba(15, 19, 25, .08)',
    sheetErrorBackdrop: 'rgba(255, 255, 255, .92)',
    drawerShadow: '0 2px 4px rgba(15, 19, 25, .05), 0 18px 48px rgba(15, 19, 25, .12)',
    raisedBackdrop: 'rgba(255, 255, 255, .68)',
    plotInset: 'rgba(47, 90, 208, .13)',
    raisedBackdropSoft: 'rgba(255, 255, 255, .5)',
    raisedBackdropMedium: 'rgba(255, 255, 255, .72)',
    permissionShadow: 'rgba(168, 98, 10, .12)',
    raisedBackdropStrong: 'rgba(255, 255, 255, .86)',
    waitBackdrop: 'rgba(253, 241, 224, .96)',
    diagramLabelBackdrop: 'rgba(255, 255, 255, .94)',
    canvasGridSoft: 'rgba(15, 19, 25, .045)',
    plotOrbit: 'rgba(47, 90, 208, .2)',
    plotOrbitInner: 'rgba(47, 90, 208, .15)',
    onEmphasisWash: 'rgba(255, 255, 255, .16)',
    sidebarShadow: '0 1px 2px rgba(15, 19, 25, .05), 0 8px 24px rgba(15, 19, 25, .07)',
    sidebarInspectorShadow: '0 2px 4px rgba(15, 19, 25, .05), 0 18px 48px rgba(15, 19, 25, .12)',
    raisedBackdropButton: 'rgba(255, 255, 255, .72)',
    raisedBackdropBadge: 'rgba(255, 255, 255, .82)',
  },
  dark: {
    shadow: '0 1px 2px rgba(0, 0, 0, .5), 0 8px 24px rgba(0, 0, 0, .4)',
    focusColor: '#7d9df5',
    headerBackdrop: 'rgba(10, 12, 16, .94)',
    onEmphasisBorder: 'rgba(255, 255, 255, .12)',
    popoverShadow: '0 2px 4px rgba(0, 0, 0, .5), 0 18px 48px rgba(0, 0, 0, .55)',
    focusWash: 'rgba(125, 157, 245, .12)',
    headerControlBackdrop: 'rgba(255, 255, 255, .06)',
    liveHalo: 'rgba(63, 191, 149, .18)',
    sheetBackdrop: 'rgba(21, 25, 32, .88)',
    lineBackdrop: 'rgba(34, 40, 49, .8)',
    canvasVignette: 'rgba(0, 0, 0, .12)',
    floatingBackdrop: 'rgba(23, 28, 36, .94)',
    componentShadow: 'rgba(0, 0, 0, .22)',
    focusWashStrong: 'rgba(125, 157, 245, .15)',
    plotControlWash: 'rgba(125, 157, 245, .13)',
    liveShadow: 'rgba(63, 191, 149, .22)',
    plotHalo: 'rgba(125, 157, 245, .1)',
    plotHaloSoft: 'rgba(125, 157, 245, .05)',
    subtleRaisedBackdrop: 'rgba(23, 28, 36, .72)',
    sketchGrid: 'rgba(232, 236, 243, .07)',
    sketchShadow: 'rgba(0, 0, 0, .3)',
    sheetErrorBackdrop: 'rgba(21, 25, 32, .9)',
    drawerShadow: '0 2px 4px rgba(0, 0, 0, .5), 0 18px 48px rgba(0, 0, 0, .55)',
    raisedBackdrop: 'rgba(255, 255, 255, .05)',
    plotInset: 'rgba(125, 157, 245, .14)',
    raisedBackdropSoft: 'rgba(255, 255, 255, .04)',
    raisedBackdropMedium: 'rgba(255, 255, 255, .06)',
    permissionShadow: 'rgba(224, 162, 82, .16)',
    raisedBackdropStrong: 'rgba(255, 255, 255, .08)',
    waitBackdrop: 'rgba(42, 30, 15, .96)',
    diagramLabelBackdrop: 'rgba(23, 28, 36, .92)',
    canvasGridSoft: 'rgba(232, 236, 243, .05)',
    plotOrbit: 'rgba(125, 157, 245, .22)',
    plotOrbitInner: 'rgba(125, 157, 245, .18)',
    onEmphasisWash: 'rgba(255, 255, 255, .1)',
    sidebarShadow: '0 1px 2px rgba(0, 0, 0, .5), 0 8px 24px rgba(0, 0, 0, .4)',
    sidebarInspectorShadow: '0 2px 4px rgba(0, 0, 0, .5), 0 18px 48px rgba(0, 0, 0, .55)',
    raisedBackdropButton: 'rgba(255, 255, 255, .05)',
    raisedBackdropBadge: 'rgba(255, 255, 255, .06)',
  },
};

export const fonts = {
  mono: 'var(--font-geist-mono), ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  sans: 'var(--font-geist), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  display: 'var(--font-archivo), var(--font-geist), ui-sans-serif, system-ui, Arial, sans-serif',
} as const;
