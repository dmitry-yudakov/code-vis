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
  sheet: '#fffdf8',
  shell: '#f7efdf',
  shellSunk: '#eadcc4',
  raised: '#fffaf0',
  ink: '#24211e',
  ink2: '#403a34',
  muted: '#746b5e',
  faint: '#a99d8d',
  line: '#d9cbb6',
  lineStrong: '#cfbea6',
  live: '#66734f',
  liveWash: '#e7eed7',
  wait: '#8c491a',
  waitWash: '#fff2eb',
  stop: '#c0663a',
  stopWash: '#f5d3c7',
  plot: '#a65322',
  plotWash: '#f4d8c2',
  add: '#42532f',
  addWash: '#edf3df',
  del: '#853e25',
  delWash: '#fae5da',
  grid: 'rgba(102, 87, 66, .14)',
  sheetSunk: '#f9f3e9',
  onEmphasis: '#fff8ec',
  absoluteWhite: '#fff',
  selectedWash: '#f3e7d5',
  idle: '#bd845f',
  liveInk: '#586443',
  liveInkStrong: '#5d6847',
  liveInkDeep: '#56613f',
  liveInkMuted: '#5b6743',
  liveInkSoft: '#596643',
  liveHover: '#5f6b4a',
  liveLine: '#c7d3ae',
  addMuted: '#4e5b39',
  untracked: '#5b554d',
  untrackedWash: '#e9e1d5',
  plotBright: '#cb6e35',
  plotLine: '#c49b7c',
  plotLineSoft: '#dfb597',
  plotLineMuted: '#d6ad8e',
  plotInk: '#7e481f',
  plotInkMuted: '#6f4d35',
  plotInkDeep: '#71431f',
  plotHover: '#8f4318',
  plotWashSoft: '#fff0e6',
  plotWashMuted: '#f4e7d5',
  waitLine: '#e7b68f',
  waitLineStrong: '#dca37e',
  waitInkMuted: '#72584a',
  waitInkStrong: '#56341c',
  waitWashMuted: '#f7dfcd',
  cancelWash: '#f5ddd0',
  cancelLine: '#e9b899',
  errorLine: '#e4aa84',
  stopLine: '#e0b79c',
  stopInk: '#754223',
  stopWashStrong: '#f4d3bd',
  controlWash: '#f1e6d4',
  inlineCodeSurface: '#eee2d0',
  codeSurface: '#2d2925',
  codeInk: '#f8ead5',
  neutralWash: '#f2eadc',
  neutralWashRaised: '#f5ecdd',
  neutralWashStrong: '#eee2cf',
  neutralWashDeep: '#e9dfcf',
  diffSurface: '#fbf6ed',
  diffMeta: '#7a6d5e',
  hunk: '#735592',
  hunkWash: '#f1eaf6',
  delStrong: '#873d20',
  placeholder: '#9b8f7f',
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
    shadow: '0 12px 40px rgba(52, 40, 25, 0.12)',
    focusColor: 'rgba(198, 105, 52, .35)',
    headerBackdrop: 'rgba(239, 226, 204, .94)',
    onEmphasisBorder: 'rgba(255, 255, 255, .15)',
    popoverShadow: '0 18px 55px rgba(50, 37, 22, .24)',
    focusWash: 'rgba(198, 105, 52, .1)',
    headerControlBackdrop: 'rgba(255, 255, 255, .32)',
    liveHalo: 'rgba(115, 128, 91, .15)',
    sheetBackdrop: 'rgba(255, 253, 248, .88)',
    lineBackdrop: 'rgba(217, 203, 182, .8)',
    canvasVignette: 'rgba(92, 73, 48, .05)',
    floatingBackdrop: 'rgba(255, 250, 240, .94)',
    componentShadow: 'rgba(76, 57, 34, .08)',
    focusWashStrong: 'rgba(198, 105, 52, .11)',
    plotControlWash: 'rgba(166, 83, 34, .13)',
    liveShadow: 'rgba(115, 128, 91, .22)',
    plotHalo: 'rgba(166, 83, 34, .08)',
    plotHaloSoft: 'rgba(166, 83, 34, .035)',
    subtleRaisedBackdrop: 'rgba(255, 250, 240, .72)',
    sketchGrid: 'rgba(140, 120, 92, .07)',
    sketchShadow: 'rgba(76, 57, 34, .09)',
    sheetErrorBackdrop: 'rgba(255, 253, 248, .9)',
    drawerShadow: '0 22px 70px rgba(50, 37, 22, .22)',
    raisedBackdrop: 'rgba(255, 255, 255, .45)',
    plotInset: 'rgba(198, 105, 52, .12)',
    raisedBackdropSoft: 'rgba(255, 255, 255, .35)',
    raisedBackdropMedium: 'rgba(255, 255, 255, .5)',
    permissionShadow: 'rgba(140, 73, 26, .12)',
    raisedBackdropStrong: 'rgba(255, 255, 255, .6)',
    waitBackdrop: 'rgba(255, 242, 235, .96)',
    diagramLabelBackdrop: 'rgba(255, 250, 240, .92)',
    canvasGridSoft: 'rgba(102, 87, 66, .11)',
    plotOrbit: 'rgba(166, 83, 34, .22)',
    plotOrbitInner: 'rgba(166, 83, 34, .18)',
    onEmphasisWash: 'rgba(255, 255, 255, .14)',
    sidebarShadow: 'rgba(52, 40, 25, .09)',
    sidebarInspectorShadow: 'rgba(52, 40, 25, .16)',
    raisedBackdropButton: 'rgba(255, 255, 255, .42)',
    raisedBackdropBadge: 'rgba(255, 255, 255, .48)',
  },
  dark: {
    shadow: '0 12px 40px rgba(0, 0, 0, .45)',
    focusColor: 'rgba(125, 157, 245, .4)',
    headerBackdrop: 'rgba(10, 12, 16, .94)',
    onEmphasisBorder: 'rgba(255, 255, 255, .12)',
    popoverShadow: '0 18px 55px rgba(0, 0, 0, .55)',
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
    drawerShadow: '0 22px 70px rgba(0, 0, 0, .6)',
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
    sidebarShadow: 'rgba(0, 0, 0, .35)',
    sidebarInspectorShadow: 'rgba(0, 0, 0, .5)',
    raisedBackdropButton: 'rgba(255, 255, 255, .05)',
    raisedBackdropBadge: 'rgba(255, 255, 255, .06)',
  },
};

export const fonts = {
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  sans: 'Figtree, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display: 'Georgia, "Times New Roman", serif',
} as const;
