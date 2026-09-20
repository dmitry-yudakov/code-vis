'use client';

import dynamic from 'next/dynamic';
import { useImmersiveLayout } from './useImmersiveLayout';
import { PANEL_IDS, PANEL_TITLES, PANEL_COMMAND_LABELS } from './workspaceLayout';
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canvasTargetId, findCanvasTarget, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { probeImmersiveCapability } from '@/features/diagram/spatial/immersiveCapability';
import type { ImmersiveAvailability, ImmersiveController, ImmersiveSemanticAction, ImmersiveWorkspaceProps } from '@/features/diagram/spatial/immersiveTypes';
import { recordImmersiveDiagnostic } from './immersiveDiagnostics';
import { noteImmersiveError, setImmersiveReportContext } from './immersiveReport';
import { SESSION_ACTIONS } from './sessionControls';
import { CONVERSATION_ACTIONS } from './conversationControls';
import { CONVERSATION_LIST_BATCH_SIZE, sortConversationChoices } from './conversationListModel';
import { CANVAS_REVIEW_ACTIONS } from './canvasReviewControls';
import { loadImmersiveFonts } from './immersiveTheme';

const ImmersiveRenderer = dynamic(() => {
  if (window.__CODEAI_XR_TEST__?.failXRImport) return Promise.reject(new Error('Injected immersive bundle failure.'));
  return import('./ImmersiveRenderer').then((module) => module.ImmersiveRenderer);
}, { ssr: false, loading: () => null });

const IMMERSIVE_FONT_TIMEOUT_MS = 1_500;

async function loadFontsBeforeEntry(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      loadImmersiveFonts(),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Immersive font loading timed out.')), IMMERSIVE_FONT_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    recordImmersiveDiagnostic('font-loading-failed');
    noteImmersiveError('font-loading-failed', error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class RendererBoundary extends Component<{ children: ReactNode; onError(message: string): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    recordImmersiveDiagnostic('renderer-error');
    noteImmersiveError('renderer-error', error);
    this.props.onError(error instanceof Error ? error.message : 'The immersive renderer could not load.');
  }
  render() { return this.state.failed ? null : this.props.children; }
}

type Props = Pick<ImmersiveWorkspaceProps, 'conversation' | 'canvasReview' | 'sessionControls' | 'viewKey' | 'evidence' | 'session' | 'theme' | 'preview' | 'runStatus' | 'pendingApprovals' | 'unread' | 'choices' | 'workspaceStatus' | 'onOpenSession'> & {
  authorized: boolean;
  onSelectCanvas(id: string): void;
  onActiveChange(active: boolean): void;
};

const ACTIONS: Array<[ImmersiveSemanticAction, string]> = [
  ['exit', 'Exit VR'], ['reset-workspace', 'Reset workspace'], ['report', 'Report problem'],
  ['previous-file', 'Previous file'], ['next-file', 'Next file'],
  ['previous-checkout', 'Previous repository'], ['next-checkout', 'Next repository'],
  ['previous-evidence', 'Previous page'], ['next-evidence', 'Next page'], ['refresh-evidence', 'Refresh changes'], ['reset-view', 'Reset view'],
  ['previous-canvas', 'Previous canvas'], ['next-canvas', 'Next canvas'],
  ['larger', 'Larger'], ['smaller', 'Smaller'], ['older', 'Older'], ['newer', 'Newer'],
  ['load-more-sessions', 'Load more'],
];

/** XR presentation state only. AppShell supplies records, navigation actions, and polling results. */
export function ImmersiveBoundary({ authorized, onSelectCanvas, onActiveChange, ...props }: Props) {
  const panelState = useImmersiveLayout(props.viewKey);
  const [availability, setAvailability] = useState<ImmersiveAvailability>('checking');
  const [reason, setReason] = useState<string>();
  const [enabled, setEnabled] = useState(false);
  const [controller, setController] = useState<ImmersiveController>();
  const [scroll, setScroll] = useState({ offset: 0, maxOffset: 0, atBottom: true, newActivity: false });
  const choices = useMemo(() => sortConversationChoices(props.choices), [props.choices]);
  const active = availability === 'active';
  const activeTarget = useMemo(() => props.session && findCanvasTarget(props.session, props.session.activeDiagramId), [props.session]);

  useEffect(() => { recordImmersiveDiagnostic('page-ready'); }, []);
  useEffect(() => { setImmersiveReportContext({ view: props.viewKey, availability }); }, [props.viewKey, availability]);

  useEffect(() => {
    let cancelled = false;
    setAvailability('checking');
    setEnabled(false);
    void loadFontsBeforeEntry().then(() => probeImmersiveCapability({ authorized })).then((result) => {
      if (cancelled) return;
      setAvailability(result.availability);
      setReason(result.reason);
      // Prepare supported devices before the entry gesture so requestSession keeps user activation.
      setEnabled(result.availability === 'available');
    });
    return () => { cancelled = true; };
  }, [authorized]);
  useEffect(() => onActiveChange(active), [active, onActiveChange]);
  useEffect(() => {
    if (!active && panelState.editing) panelState.onPanelAction(panelState.editing.id, 'done');
  }, [active, panelState.editing, panelState.onPanelAction]);
  const handleAvailability = useCallback((next: ImmersiveAvailability, detail?: string) => {
    setAvailability(next);
    setReason(detail);
  }, []);
  const selectRelative = (delta: number) => {
    if (!props.session) return;
    const ids = [...getArtifacts(props.session).map((artifact) => artifact.id), ...getSketches(props.session).map((sketch) => sketch.id)];
    const index = activeTarget ? ids.indexOf(canvasTargetId(activeTarget)) : 0;
    const next = ids[(Math.max(0, index) + delta + ids.length) % ids.length];
    if (next) onSelectCanvas(next);
  };

  return <div className={`immersive-entry ${availability}`}>
    {availability === 'active' ? <strong>Immersive workspace active</strong>
      : enabled ? <button type="button" className="immersive-enter" disabled={!controller || availability === 'entering'} onClick={() => void controller?.enter()}>
        {availability === 'entering' ? 'Entering VR…' : controller ? 'Enter VR' : 'Preparing VR…'}
      </button>
        : <details><summary>{availability === 'checking' ? 'Checking VR…' : 'VR unavailable'}</summary><p>{reason}</p></details>}
    {enabled && reason && <span role="alert">{reason}</span>}
    {enabled && authorized && <RendererBoundary onError={(message) => handleAvailability('failed', `The immersive renderer could not load: ${message}`)}>
      <ImmersiveRenderer {...props} {...panelState}
        active={active} activeTarget={activeTarget} choices={choices}
        onConversationScroll={setScroll}
        onPreviousCanvas={() => selectRelative(-1)} onNextCanvas={() => selectRelative(1)}
        onExit={() => undefined}
        onController={setController} onAvailability={handleAvailability}
      />
    </RendererBoundary>}
    {active && <div className="immersive-semantic-controls" role="group" aria-label="Immersive workspace controls">
      <strong>{props.session?.title || 'Session launcher'}</strong><span role="status">{props.workspaceStatus}</span>
      {scroll.newActivity && <strong>New activity</strong>}
      {Object.entries(CONVERSATION_ACTIONS).map(([action, label]) => <button key={action} type="button"
        data-immersive-action={`conversation:${action}`}
        onClick={() => controller?.perform(`conversation:${action}` as ImmersiveSemanticAction)}>Conversation: {label}</button>)}
      {Object.entries(SESSION_ACTIONS).map(([action, label]) => <button key={action} type="button"
        data-immersive-action={`session:${action}`} onClick={() => controller?.perform(`session:${action}` as ImmersiveSemanticAction)}>Session: {label}</button>)}
      {Object.entries(CANVAS_REVIEW_ACTIONS).map(([action, label]) => <button key={action} type="button"
        data-immersive-action={`canvas:${action}`} onClick={() => controller?.perform(`canvas:${action}` as ImmersiveSemanticAction)}>Canvas: {label}</button>)}
      {ACTIONS.map(([action, label]) => <button key={action} type="button" data-immersive-action={action}
        disabled={(action === 'older' && scroll.offset <= 0) || (action === 'newer' && scroll.atBottom)}
        onClick={() => controller?.perform(action)}>{label}</button>)}
      {PANEL_IDS.map((id) => <fieldset key={id} data-immersive-panel={id} data-open={panelState.layout.panels[id].open}
        data-focused={panelState.layout.focused === id} data-layout={JSON.stringify(panelState.layout.panels[id])}>
        <legend>{PANEL_TITLES[id]}</legend>
        {Object.entries(PANEL_COMMAND_LABELS).map(([command, label]) => <button type="button" key={command}
          data-immersive-action={`panel:${id}:${command}`} onClick={() => controller?.perform(`panel:${id}:${command}` as ImmersiveSemanticAction)}>
          {label} {PANEL_TITLES[id]}
        </button>)}
      </fieldset>)}
      {choices.slice(0, CONVERSATION_LIST_BATCH_SIZE).map((choice) => <button
        type="button" key={`${choice.machineId}:${choice.sessionId}`} data-immersive-session={choice.sessionId}
        onClick={() => props.onOpenSession(choice)}>{choice.title} · {choice.detail}</button>)}
    </div>}
  </div>;
}
