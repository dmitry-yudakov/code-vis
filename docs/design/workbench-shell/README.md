# Workbench design refinements

The HTML boards preserve the original geometry proposal. The current MUI appearance is owned by
`src/features/shell/desktopTheme.ts` and production-browser fixtures in `e2e/`.

Story 118 replaces desktop edge-to-edge panes with aligned 4px insets and 8px corners.
[Story 120](../../../stories/STORY-20261031-mobile-pane-maximize.md) refines the Phone and PhoneDark
boards: a 44px single-row title bar, one full-width module, then Chat, Canvas, Changes, History and
More in a bottom bar below the existing 740px docking threshold. Reports, Arena, Inbox and Devices
live in More for an open phone session. Composer metadata shares one row below the input; the input
starts at one 16px line and grows. Reply text stays 14px, with less padding and a 1.55 line height.

Each pane header has maximize/restore. Desktop keeps the title bar and activity rail; narrow
maximize gives the pane the viewport and hides shell chrome. Restore retains the underlying
arrangement. Hidden chat approvals are badged and reachable from the maximized pane. Canvas Focus
becomes maximize, and New sketch remains in Attach instead of the canvas toolbar.

`e2e/mobile-panes.spec.ts` owns the implemented phone/maximize geometry and both-theme screenshots;
`e2e/desktop-workspace.spec.ts` retains the desktop frames and minimum widths.
