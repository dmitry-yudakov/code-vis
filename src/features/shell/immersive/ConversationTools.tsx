import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { palette, type ThemeName } from '@/shared/design/tokens';
import { AGENT_ROLES, AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';
import { draftTokens, editVoiceDraft, spellVoiceText } from '@/features/conversation/voiceEditing';
import { useVoiceDraft } from '@/features/conversation/useVoiceDraft';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { CONVERSATION_ACTIONS, type ConversationActionName, type ImmersiveConversationControls } from './conversationControls';
import { createConversationTextResource } from './workspaceResources';
import { createWorkspaceIconResource, type WorkspaceIcon } from './workspaceIcons';
import { workspaceTextLines } from './workspaceText';
import { useTextureResource } from './useTextureResource';
import { WorldButton } from './WorkspacePanel';
import { InlineConversationInput } from './InlineConversationInput';

type Tab = 'read' | 'compose' | 'agents';

const ICONS: Record<ConversationActionName, WorkspaceIcon> = {
  read: 'chat', compose: 'compose', agents: 'agents', latest: 'down', help: 'help',
  record: 'microphone', retry: 'refresh', stop: 'stop', discard: 'close', send: 'send', cancel: 'stop',
  append: 'check', replace: 'replace', 'replace-all': 'replace', spell: 'spell',
  'previous-word': 'chevron-left', 'next-word': 'chevron-right', delete: 'trash', clear: 'close',
  undo: 'undo', newline: 'newline', 'draft-older': 'chevron-left', 'draft-newer': 'chevron-right',
  'previous-agent': 'chevron-left', 'next-agent': 'chevron-right', 'make-primary': 'check',
  ask: 'help', plan: 'edit', agent: 'settings', provider: 'agents', role: 'settings', add: 'plus',
  edit: 'settings', done: 'check',
  list: 'history', back: 'chevron-left',
};

function VoiceActivity({ level, theme }: { level: number; theme: ThemeName }) {
  const resource = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(0.025, 0.1)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: palette[theme].live, toneMapped: false })),
  }), [theme]);
  return resource && <group name="Microphone activity" position={[-0.20, -0.77, 0.06]}>
    {Array.from({ length: 13 }, (_, index) => <mesh key={index} geometry={resource.geometry} material={resource.material}
      position-x={(index - 6) * 0.045} scale-y={0.12 + level * (1 - Math.abs(index - 6) / 9)} />)}
  </group>;
}

export function ConversationTools({ controls, theme, enabled, visible = true, tab, atBottom, renderHistory, onTab, onLatest, onVoicePending, onController }: {
  controls?: ImmersiveConversationControls;
  theme: ThemeName;
  enabled: boolean;
  visible?: boolean;
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
  const displayedStatus = editing && selected && !voiceBusy
    ? `${voiceStatus}\nSelected: ${selected.text === '\n' ? 'New line' : selected.text}` : voiceStatus;
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
    '', expanded ? statusLines.slice(0, 3) : workspaceTextLines(inlineStatus, 58).slice(0, 2), theme, ledger, true,
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
  const labels = useTextureResource((ledger) => !visible ? undefined : Object.fromEntries(visibleActions.map((action) => [action, {
    icon: createWorkspaceIconResource(ICONS[action], theme, ledger),
  }])), [visible, visibleActions.join(','), theme]);
  const disabled = (action: ConversationActionName) => {
    if (!enabled || !visible) return true;
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
    action={`conversation:${action}`} label={CONVERSATION_ACTIONS[action]} resource={labels?.[action]?.icon}
    iconTheme={theme} position={position}
    disabled={disabled(action)} selected={action === tab || action === controls?.mode} onAction={() => perform(action)} />;
  return <group name="Conversation tools" visible={visible} userData={{ conversationTab: tab, draft, voicePhase: voice.phase, voiceResult: voice.result, voiceStatus: displayedStatus,
    voiceLevel: voice.activity.level, voiceSeconds: voice.activity.seconds, editing, selectedWord: selected?.text }}>
    {renderHistory(visible && !expanded)}
    {resource && <mesh name="VR draft and agents" geometry={resource.geometry} material={resource.material}
      position={[0, 0.2, 0.02]} />}
    {statusResource && <mesh name="Voice status" geometry={statusResource.geometry} material={statusResource.material}
      position={[0, expanded ? -0.34 : -0.49, 0.025]} />}
    {visible && !expanded && controls && <InlineConversationInput draft={draft} theme={theme}
      enabled={enabled && !locked && !voiceBusy} onDraft={controls.onDraft} />}
    {voice.phase === 'recording' && <VoiceActivity level={voice.activity.level} theme={theme} />}
    {!expanded && !atBottom && button('latest', [0.55, -0.32, 0.05])}
    {actions.map((action, i) => button(action, !expanded
      ? action === 'send' || action === 'discard' || action === 'cancel'
        ? [0.56, -0.70, 0.04] : action === 'clear'
          ? [0.35, -0.70, 0.04] : [draft && !controls?.running ? 0.14 : 0.35, -0.70, 0.04]
      :
      [(i % 6 - (Math.min(6, actions.length - Math.floor(i / 6) * 6) - 1) / 2) * 0.215,
        actions.length > 6 ? -0.58 - Math.floor(i / 6) * 0.22 : -0.76, 0.03]))}
  </group>;
}
