import { z } from 'zod';
import { AGENT_MODES } from '@/shared/agentModes';
import { observerProposalSchema, type ObserverProposal } from '@/shared/observer';
import type { ArenaMachineSnapshot, PublicSession } from '@/shared/types';
import type { ArenaReplyOptions } from '@/features/arena/useArenaReplies';
import { machineApiPath } from '@/features/machines/routes';
import { launchSession } from '@/features/session-launch/sessionLaunch';
import { reconcileMessageAcceptance } from '@/features/conversation/draftLifecycle';
import { createUuid } from '@/shared/uuid';

export const observerDeliverySchema = observerProposalSchema.extend({
  messageId: z.string().uuid(), participantId: z.string().uuid(), revision: z.number().int().min(0),
  title: z.string().max(500), mode: z.enum(AGENT_MODES),
  modelSelection: z.object({ model: z.string().max(200).optional(), effort: z.string().max(40).optional() }).strict(),
  attempted: z.boolean(),
});
export type ObserverDelivery = z.infer<typeof observerDeliverySchema>;
export type ReplyOptions = (machine: ArenaMachineSnapshot, summary: ArenaMachineSnapshot['sessions'][number]) => ArenaReplyOptions;

function available(target: ObserverProposal, machines: ArenaMachineSnapshot[], options: ReplyOptions) {
  const machine = machines.find(m => m.machine.id === target.machineId);
  const summary = machine?.sessions.find(s => s.id === target.sessionId);
  if (!machine || !summary || machine.machine.state !== 'online' || machine.snapshotFresh === false) throw new Error('Refresh the overview before sending. The message is kept.');
  if (summary.archivedAt || machine.runs.active.some(r => r.sessionId === summary.id)) throw new Error('This session is busy or queued. Wait for its turn to finish.');
  const choices = options(machine, summary);
  if (choices.unavailableReason || !choices.modes.includes(choices.mode)) throw new Error(choices.unavailableReason || 'Open the session to choose an available mode.');
  return { machine, summary, choices };
}

async function load(target: ObserverProposal, localMachineId: string): Promise<PublicSession> {
  const response = await fetch(machineApiPath(`/api/sessions/${target.sessionId}`, target.machineId, localMachineId), { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || data.session?.id !== target.sessionId || data.session.archivedAt) throw new Error('This session is unavailable. Refresh the overview.');
  return data.session;
}

export async function previewObserverDelivery(target: ObserverProposal, machines: ArenaMachineSnapshot[], localMachineId: string, options: ReplyOptions): Promise<ObserverDelivery> {
  const machine = machines.find(m => m.machine.id === target.machineId);
  const summary = machine?.sessions.find(s => s.id === target.sessionId);
  if (!machine || !summary || !summary.primaryAgentId) throw new Error('The target is unavailable. Ask again after refreshing.');
  const choices = options(machine, summary);
  const initial: ObserverDelivery = { ...target, messageId: createUuid(), participantId: summary.primaryAgentId, revision: summary.revision,
    title: `${machine.machine.label} · ${machine.projects.find(p => p.id === summary.projectId)?.name ?? 'No project'} · ${summary.title}`,
    mode: choices.mode, modelSelection: choices.modelSelection, attempted: false };
  // Keep the proposed wording even when the target cannot currently accept it.
  if (machine.machine.state !== 'online' || machine.snapshotFresh === false || choices.unavailableReason
    || machine.runs.active.some(r => r.sessionId === summary.id)) return initial;
  const session = await load(target, localMachineId);
  if (session.projectId !== summary.projectId || !summary.primaryAgentId || session.primaryAgentId !== summary.primaryAgentId) throw new Error('This session changed. Ask again before sending.');
  return { ...initial, revision: session.revision };
}

export async function checkObserverDelivery(delivery: ObserverDelivery, localMachineId: string) {
  return reconcileMessageAcceptance(machineApiPath(`/api/sessions/${delivery.sessionId}`, delivery.machineId, localMachineId), delivery.messageId);
}

/** Retransmission preserves the immutable request; acceptance is checked before availability. */
export async function sendObserverDelivery(delivery: ObserverDelivery, machines: ArenaMachineSnapshot[], localMachineId: string,
  options: ReplyOptions, beforePost: () => void): Promise<void> {
  let session: PublicSession;
  if (delivery.attempted) {
    const result = await checkObserverDelivery(delivery, localMachineId);
    if (result.state === 'accepted') return;
    if (result.state === 'unknown') throw new Error('Delivery is unknown. Check delivery when the machine reconnects.');
    session = result.session;
  } else session = await load(delivery, localMachineId);
  const { summary, choices } = available(delivery, machines, options);
  if (!session.repositories.some(repository => repository.role === 'primary')) throw new Error('Open the session and attach a repository before sending.');
  if (session.archivedAt || session.primaryAgentId !== delivery.participantId || session.projectId !== summary.projectId
    || (!delivery.attempted && session.revision !== delivery.revision)
    || choices.mode !== delivery.mode || JSON.stringify(choices.modelSelection) !== JSON.stringify(delivery.modelSelection)) {
    throw new Error(delivery.attempted
      ? 'The original session or execution choices changed. Open the original session and check delivery there; the request identity is kept.'
      : 'The session or execution choices changed. Cancel this preview and ask again.');
  }
  const agent = session.participants.find(p => p.id === delivery.participantId && p.kind === 'agent');
  if (!agent || agent.kind !== 'agent') throw new Error('The original agent is unavailable. Open the session.');
  beforePost();
  await launchSession({ session, messageId: delivery.messageId, creationRequestId: delivery.messageId,
    settings: { machineId: delivery.machineId, projectId: session.projectId, execution: session.execution ?? 'local',
      provider: agent.provider, checkoutMode: 'current', mode: delivery.mode, modelSelection: delivery.modelSelection },
    content: { text: delivery.text, images: [], files: [], reportIds: [] } }, localMachineId);
}
