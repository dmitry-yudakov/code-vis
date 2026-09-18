import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import { AGENT_ROLES, AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';
import { draftTokens, editVoiceDraft, spellVoiceText } from '@/features/conversation/voiceEditing';
import { useVoiceDraft } from '@/features/conversation/useVoiceDraft';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { centeredControlRow, CONVERSATION_ACTIONS, type ConversationActionName, type ImmersiveConversationControls } from './conversationControls';
import { createConversationTextResource, createWorkspaceButtonResource } from './workspaceResources';
import { createWorkspaceIconResource, isWorkspaceIconAction } from './workspaceIcons';
import { workspaceTextLines } from './workspaceText';
import { useTextureResource } from './useTextureResource';
import { ControlGroupSurface, WorkspacePager, WorldButton } from './WorkspacePanel';
import { InlineConversationInput } from './InlineConversationInput';
import { immersiveTheme } from './immersiveTheme';

type Tab = 'read' | 'compose' | 'agents';

function VoiceActivity({ level, theme }: { level: number; theme: ThemeName }) {
  const resource = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(0.025, 0.1)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: immersiveTheme[theme].positive, toneMapped: false, depthWrite: false })),
  }), [theme]);
  return resource && <group name="Microphone activity" position={[-0.20, -0.77, 0]}>
    {Array.from({ length: 13 }, (_, index) => <mesh key={index} geometry={resource.geometry} material={resource.material}
      position-x={(index - 6) * 0.045} scale-y={0.12 + level * (1 - Math.abs(index - 6) / 9)} />)}
  </group>;
}

export function ConversationTools({ controls, theme, enabled, visible = true, controllerOnly = false, tab, atBottom, renderHistory, onTab, onLatest, onVoicePending, onController }: {
  controls?: ImmersiveConversationControls;
  theme: ThemeName;
  enabled: boolean;
  visible?: boolean;
  controllerOnly?: boolean;
  tab: Tab;
  atBottom: boolean;
  renderHistory(visible: boolean): ReactNode;
  onTab(tab: Tab): void;
  onLatest(): void;
  onVoicePending(pending: boolean): void;
  onController(perform?: (action: ConversationActionName) => void): void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const [word, setWord] = useState(-1);
  const [error, setError] = useState('');
  const [providerIndex, setProviderIndex] = useState(0);
  const [roleIndex, setRoleIndex] = useState(2);
  const undo = useRef<string[]>([]);
  const draftRef = useRef(controls?.draft || '');
  draftRef.current = controls?.draft || '';
  // Temporarily disabling pointer interaction during a panel drag must not discard speech.
  const voice = useVoiceDraft(tab !== 'agents' && visible && Boolean(controls) && !controls?.running);
  const draft = controls?.draft || '';
  const tokens = useMemo(() => draftTokens(draft), [draft]);
  const selected = tokens[word];
  const provider = controls?.providers[providerIndex % (controls.providers.length || 1)];
  const role = AGENT_ROLES[roleIndex];
  const activeAgent = controls?.agents.find((agent) => agent.id === controls.activeAgentId);
  const agentIndex = Math.max(0, controls?.agents.findIndex((agent) => agent.id === controls.activeAgentId) ?? 0);
  const locked = !controls || controls.running || controls.busy;
  const voiceBusy = voice.phase !== 'idle';
  const voicePending = voiceBusy || Boolean(voice.result);
  useEffect(() => { onVoicePending(voicePending); return () => onVoicePending(false); }, [voicePending, onVoicePending]);
  const expanded = tab === 'agents' || showHelp || editing || Boolean(voice.result);
  const text = showHelp ? [
    'Dictate, then Stop recording. Review the speech before appending or replacing text. Send is always explicit.',
    'Previous/Next word selects a word or path. Replace word replaces that selection. Delete word and Undo edit also work on the draft.',
    'For exact identifiers: dictate NATO letter names and choose Spell speech, then review and Append or Replace word.',
    'Example: capital alpha papa papa dot tango sierra xray becomes App.tsx. Say slash, backslash, underscore, dash, space, or new line for those characters.',
    'NATO alphabet: alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu.',
    'Digits: zero one two three four five six seven eight nine. Capital or uppercase changes the next letter.',
    'Symbols: colon semicolon comma quote apostrophe equals plus star at hash dollar percent ampersand question exclamation backtick tilde pipe caret less greater.',
    'Say open or close, then parenthesis, bracket, or brace. Choose Compose above to return to your draft.',
  ].join('\n\n') : tab === 'agents' ? [
    controls?.target || 'Open a session first.',
    `${activeAgent?.displayName || 'No agent'} · ${activeAgent ? AGENT_ROLE_LABELS[activeAgent.role] : ''}`,
    `Main: ${controls?.agents.find((agent) => agent.id === controls.primaryAgentId)?.displayName || 'None'}`,
    `Add: ${provider ? PROVIDER_LABELS[provider] : 'No provider available'} · ${AGENT_ROLE_LABELS[role]}`,
    controls?.busy ? 'Updating agents…' : controls?.running ? 'Agent controls available after this run.' : 'Select an agent and a supported mode.',
  ].join('\n\n') : voice.result || draft || (voice.phase === 'recording'
    ? 'Listening…\n\nYour words will appear here after you stop recording.'
    : voice.phase === 'transcribing' ? 'Turning your speech into a message…'
      : 'What would you like to work on?\n\nUse the microphone to start your message.');
  const lines = useMemo(() => immersiveChatLines(text, 976, 38), [text]);
  const pageCount = Math.max(1, Math.ceil(lines.length / 10));
  const safePage = Math.min(page, pageCount - 1);
  const seconds = Math.floor(voice.activity.seconds);
  const recordingStatus = `${voice.status}\n${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 1:00`;
  const voiceStatus = error || (controls?.running ? controls.runStatus
    : voice.phase === 'recording' ? recordingStatus
      : tab !== 'agents' ? voice.status : 'Choose an agent and mode');
  const displayedStatus = voiceStatus;
  const context = !voiceBusy && !voice.result && !showHelp && !editing && tab !== 'agents'
    ? `${activeAgent?.displayName || 'No agent'} · ${controls?.mode || ''}${controls?.attachments.length ? ` · ${controls.attachments.join('; ')}` : ''}` : '';
  const resource = useTextureResource((ledger) => !visible || !expanded ? undefined : createConversationTextResource(
    `${showHelp ? 'Voice help' : tab === 'agents' ? 'Agents' : voice.result ? 'Review your words' : 'Your message'}${pageCount > 1 ? ` · ${safePage + 1}/${pageCount}` : ''}`,
    lines.slice(safePage * 10, safePage * 10 + 10), theme, ledger,
  ), [visible, expanded, tab, text, showHelp, safePage, pageCount, theme]);
  // Give recording and recovery messages a separate, readable three-line surface.
  const statusLines = workspaceTextLines(context ? `${displayedStatus}\n${context}` : displayedStatus, 48);
  const inlineStatus = voice.phase === 'recording' ? `Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · Stop to transcribe`
    : voiceBusy || error || !['Ready to dictate', 'Ready to send', 'Draft preserved'].includes(voice.status) ? displayedStatus.split('\n')[0] : context;
  const statusResource = useTextureResource((ledger) => !visible ? undefined : createConversationTextResource(
    '', expanded ? statusLines.slice(0, 3) : workspaceTextLines(inlineStatus, 58).slice(0, 1), theme, ledger, true, !expanded,
  ), [visible, expanded, displayedStatus, inlineStatus, context, theme]);

  const actions: ConversationActionName[] = showHelp ? ['done']
    : tab === 'agents' ? controls?.running ? ['read'] : ['read', 'previous-agent', 'next-agent', 'make-primary', 'ask', 'plan', 'agent', 'provider', 'role', 'add']
      : voiceBusy ? ['stop', 'discard']
        : controls?.running ? ['record']
          : voice.result ? editing
            ? ['done', 'append', 'replace', 'replace-all', 'spell', 'previous-word', 'next-word', 'discard']
            : ['append', ...(selected ? ['replace' as const] : []), 'edit', 'discard']
          : editing ? ['done', 'previous-word', 'next-word', 'delete', 'clear', 'undo', 'newline', voice.configured ? 'record' : 'retry', 'help']
            : [voice.configured ? 'record' : 'retry', ...(draft ? ['clear' as const] : []), 'send'];
  if (expanded && pageCount > 1 && !voiceBusy) actions.push('draft-older', 'draft-newer');
  if (controls?.runId) actions.push('cancel');
  const visibleActions = [...actions, ...(!expanded && !atBottom ? ['latest' as const] : [])];
  const controllerAvailable = visible || controllerOnly;
  const actionLabel = (action: ConversationActionName) => action === 'provider'
    ? `Provider: ${provider ? PROVIDER_LABELS[provider] : 'None'}`
    : action === 'role' ? `Role: ${AGENT_ROLE_LABELS[role]}` : CONVERSATION_ACTIONS[action];
  const labels = useTextureResource((ledger) => !visible ? undefined : Object.fromEntries(visibleActions.map((action) => {
    const iconAction = `conversation:${action}`;
    return [action, { icon: isWorkspaceIconAction(iconAction)
      ? createWorkspaceIconResource(iconAction, theme, ledger)
      : createWorkspaceButtonResource(actionLabel(action), theme, ledger) }];
  })), [visible, visibleActions.join(','), provider, role, theme]);
  const disabled = (action: ConversationActionName) => {
    if (!enabled || !controllerAvailable) return true;
    if (action === 'read' || action === 'compose' || action === 'agents' || action === 'latest') return false;
    if (action === 'discard') return false;
    if (action === 'help') return false;
    if (action === 'done' || action === 'edit') return false;
    if (action === 'list') return false;
    if (action === 'cancel') return !controls?.runId;
    if (action === 'draft-older') return safePage === 0;
    if (action === 'draft-newer') return safePage >= pageCount - 1;
    if (action === 'stop') return voice.phase !== 'recording';
    if (locked || voiceBusy) return true;
    if (action === 'send') return !controls.canSend || Boolean(voice.result);
    if (action === 'record') return !voice.configured;
    if (action === 'delete' || action === 'replace') return !selected;
    if (action === 'undo') return !undo.current.length;
    if (action === 'clear') return !draft;
    if (action === 'ask' || action === 'plan' || action === 'agent') return controls.unsupportedModes.includes(action);
    if (action === 'add' || action === 'provider') return !provider;
    if (action === 'make-primary') return !activeAgent || activeAgent.id === controls.primaryAgentId;
    if (action === 'previous-agent' || action === 'next-agent') return controls.agents.length < 2;
    if (action === 'previous-word') return word < 0;
    if (action === 'next-word') return word >= tokens.length - 1;
    return false;
  };
  const perform = (action: ConversationActionName) => {
    if ((!visibleActions.includes(action) && !['read', 'compose', 'agents', 'latest'].includes(action)) || disabled(action)) return;
    setError('');
    const edit = (next: string) => {
      undo.current = [...undo.current.slice(-19), draftRef.current];
      draftRef.current = next;
      controls?.onDraft(next);
    };
    try {
      if (action === 'read' || action === 'compose' || action === 'agents') {
        if (action === tab) return;
        voice.discard(); setShowHelp(false); setEditing(false); onTab(action); setPage(0);
      } else if (action === 'edit') { setEditing(true);
      } else if (action === 'done') { setEditing(false); setShowHelp(false); setPage(0);
      } else if (action === 'help') { setShowHelp(true); setPage(0);
      } else if (action === 'latest') onLatest();
      else if (action === 'record') void voice.start();
      else if (action === 'retry') voice.retry();
      else if (action === 'stop') void voice.stop();
      else if (action === 'discard') voice.discard();
      else if (action === 'send') { controls?.onSend(); onLatest(); onTab('read'); }
      else if (action === 'cancel') controls?.onCancel();
      else if (action === 'draft-older') setPage(Math.max(0, safePage - 1));
      else if (action === 'draft-newer') setPage(Math.min(pageCount - 1, safePage + 1));
      else if (action === 'previous-word' || action === 'next-word') setWord(word + (action === 'next-word' ? 1 : -1));
      else if (action === 'undo') { const previous = undo.current.pop(); if (previous !== undefined) { draftRef.current = previous; controls?.onDraft(previous); } }
      else if (action === 'clear') {
        document.querySelector<HTMLTextAreaElement>('[data-immersive-message-input]')?.blur();
        edit(''); setWord(-1);
      }
      else if (action === 'delete') { edit(editVoiceDraft(draftRef.current, '', selected)); setWord(-1); }
      else if (action === 'newline') edit(editVoiceDraft(draftRef.current, '\n'));
      else if (action === 'spell') {
        // Applying the spelling also requires an explicit append/replace selection.
        const spelled = spellVoiceText(voice.result);
        voice.replaceResult(spelled);
        setError('Review the spelled text. Choose Append or Replace.');
      } else if (action === 'append' || action === 'replace' || action === 'replace-all') {
        const replacement = voice.result;
        edit(editVoiceDraft(draftRef.current, replacement, action === 'replace-all'
          ? { start: 0, end: draftRef.current.length, text: draftRef.current } : action === 'replace' ? selected : undefined));
        voice.clearResult(); setWord(-1); setPage(0);
      } else if (action === 'ask' || action === 'plan' || action === 'agent') controls?.onMode(action);
      else if (action === 'previous-agent' || action === 'next-agent') {
        const agents = controls?.agents || [];
        const index = agents.findIndex((agent) => agent.id === controls?.activeAgentId);
        const next = agents[(index + (action === 'next-agent' ? 1 : -1) + agents.length) % agents.length];
        if (next) controls?.onSelectAgent(next.id);
      } else if (action === 'make-primary' && activeAgent) controls?.onMakePrimary(activeAgent.id);
      else if (action === 'provider') setProviderIndex((index) => index + 1);
      else if (action === 'role') setRoleIndex((index) => (index + 1) % AGENT_ROLES.length);
      else if (action === 'add' && provider) controls?.onAddAgent(provider, role);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Draft edit failed.'); }
  };
  useEffect(() => { onController(perform); return () => onController(undefined); }, [onController, perform]);
  const button = (action: ConversationActionName, position: [number, number, number]) => <WorldButton key={action === 'cancel' ? `${action}:${controls?.cancelKey}` : action}
    action={`conversation:${action}`} label={actionLabel(action)} resource={labels?.[action]?.icon}
    iconTheme={theme} position={position}
    disabled={disabled(action)} selected={action === tab || action === controls?.mode}
    variant={action === 'send' ? 'primary' : action === 'discard' || action === 'cancel' ? 'destructive' : 'secondary'}
    onAction={() => perform(action)} />;
  const pagerActions = new Set<ConversationActionName>(['previous-word', 'next-word', 'draft-older', 'draft-newer', 'previous-agent', 'next-agent']);
  const editingRow = centeredControlRow((['retry', 'help', 'clear', 'done'] as ConversationActionName[])
    .filter((action) => editing && !voice.result && actions.includes(action))
    .map((action) => ({ key: action, width: labels?.[action]?.icon.width || 0.14 })));
  const actionPosition = (action: ConversationActionName, index: number): [number, number, number] => {
    if (action === 'cancel') return [0.48, expanded ? -0.34 : -0.43, 0];
    if (!expanded) return action === 'send' || action === 'discard' ? [0.55, -0.70, 0]
      : action === 'clear' ? [0.37, -0.70, 0] : [draft && !controls?.running ? 0.18 : 0.37, -0.70, 0];
    if (tab === 'agents') {
      const positions: Partial<Record<ConversationActionName, [number, number, number]>> = {
        read: [-0.51, 0.48, 0], ask: [-0.42, -0.44, 0], plan: [-0.14, -0.44, 0], agent: [0.14, -0.44, 0],
        'make-primary': [0.46, -0.44, 0], provider: [-0.40, -0.68, 0], role: [0, -0.68, 0], add: [0.40, -0.68, 0],
      };
      return positions[action] || [0, -0.68, 0];
    }
    const editingX = editingRow.get(action);
    if (editingX !== undefined) return [editingX, -0.73, 0];
    const reviewPositions: Partial<Record<ConversationActionName, [number, number, number]>> = {
      delete: [-0.48, -0.52, 0], undo: [-0.30, -0.52, 0], newline: [-0.12, -0.52, 0], record: [0.06, -0.52, 0],
      append: [-0.43, -0.52, 0], replace: [-0.12, -0.52, 0], 'replace-all': [0.20, -0.52, 0], spell: [0.48, -0.52, 0],
      discard: [-0.39, -0.73, 0], help: [-0.08, -0.73, 0], done: [0.22, -0.73, 0], edit: [0.42, -0.73, 0],
      stop: [-0.18, -0.73, 0], retry: [-0.18, -0.73, 0], clear: [0.12, -0.73, 0], send: [0.43, -0.73, 0],
    };
    return reviewPositions[action] || [(index - 2) * 0.22, -0.73, 0];
  };
  return <group name="Conversation tools" visible={visible} userData={{ conversationTab: tab, draft, voicePhase: voice.phase, voiceResult: voice.result, voiceStatus: displayedStatus,
    voiceLevel: voice.activity.level, voiceSeconds: voice.activity.seconds, editing, selectedWord: selected?.text }}>
    {renderHistory(visible && !expanded)}
    {resource && <mesh name="VR draft and agents" geometry={resource.geometry} material={resource.material}
      position={[0, 0.2, 0]} />}
    {statusResource && <mesh name="Voice status" geometry={statusResource.geometry} material={statusResource.material}
      position={[0, expanded ? -0.34 : -0.45, 0.0005]} renderOrder={12} />}
    {visible && !expanded && controls && <InlineConversationInput draft={draft} theme={theme}
      enabled={enabled && !locked && !voiceBusy} onDraft={controls.onDraft} />}
    {voice.phase === 'recording' && <VoiceActivity level={voice.activity.level} theme={theme} />}
    {!expanded && !atBottom && button('latest', [0.55, -0.32, 0])}
    {expanded && pageCount > 1 && tab !== 'agents' && <WorkspacePager label={`Page ${safePage + 1} of ${pageCount}`}
      previousAction="conversation:draft-older" nextAction="conversation:draft-newer" previousLabel="Previous page" nextLabel="Next page"
      position={[0.33, 0.48, 0]} theme={theme} previousDisabled={safePage === 0} nextDisabled={safePage >= pageCount - 1}
      onAction={(action) => perform(action.slice('conversation:'.length) as ConversationActionName)} />}
    {tab === 'agents' && expanded && <WorkspacePager label={`Agent ${agentIndex + 1} of ${Math.max(1, controls?.agents.length || 0)}`}
      previousAction="conversation:previous-agent" nextAction="conversation:next-agent" previousLabel="Previous agent" nextLabel="Next agent"
      position={[0.18, 0.48, 0]} theme={theme} previousDisabled={(controls?.agents.length || 0) < 2} nextDisabled={(controls?.agents.length || 0) < 2}
      onAction={(action) => perform(action.slice('conversation:'.length) as ConversationActionName)} />}
    {tab === 'agents' && expanded && <ControlGroupSurface name="Agent mode selector" width={0.82}
      position={[-0.14, -0.44, 0]} theme={theme} />}
    {editing && !voiceBusy && <WorkspacePager label={`Selected: ${selected?.text === '\n' ? 'New line' : selected?.text || 'None'}`}
      previousAction="conversation:previous-word" nextAction="conversation:next-word" previousLabel="Previous word" nextLabel="Next word"
      position={[0, -0.32, 0]} theme={theme} previousDisabled={word < 0} nextDisabled={word >= tokens.length - 1}
      onAction={(action) => perform(action.slice('conversation:'.length) as ConversationActionName)} />}
    {actions.filter((action) => !pagerActions.has(action)).map((action, index) => button(action, actionPosition(action, index)))}
  </group>;
}
