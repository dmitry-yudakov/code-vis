import { randomUUID } from 'node:crypto';
import { hostname as systemHostname } from 'node:os';
import {
  chmod, mkdir, open, readFile, readdir, rename, stat, unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  AgentProvider, AgentRole, AssistantMessage, DiagramAnnotation, DurableConversation, Participant,
  ProjectAttachment, PublicConversation, ServerAgentParticipant, SketchCanvas, UserMessage,
} from '@/shared/types';
import { durableConversationSchema, publicConversationSchema } from '@/shared/conversationSchema';
import {
  AGENT_ROLE_DEFAULT_MODES, AGENT_ROLE_LABELS, PROVIDER_LABELS, humanParticipantId,
} from '@/shared/participants';

const STORE_VERSION = 1;
const STORE_DIRECTORY = 'conversation-store-v1';
const LOCK_STALE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const MAX_CONVERSATIONS = 1_000;

const manifestSchema = z.object({
  version: z.literal(1),
  host: z.object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(200),
  }).strict(),
}).strict();

const writerLockSchema = z.object({
  version: z.literal(1),
  ownerToken: z.string().uuid(),
  pid: z.number().int().positive(),
  hostname: z.string().trim().min(1).max(500),
  heartbeat: z.string().datetime(),
}).strict();

export type ConversationStoreErrorCode = 'unknown' | 'conflict' | 'locked' | 'corrupt';

export class ConversationStoreError extends Error {
  constructor(public readonly code: ConversationStoreErrorCode, message: string) {
    super(message);
    this.name = 'ConversationStoreError';
  }
}

export interface ConversationStoreOptions {
  hostLabel?: string;
  hostname?: string;
  pid?: number;
  now?: () => Date;
  lockStaleMs?: number;
  heartbeatMs?: number;
  /** Test hook used to prove a failed pre-rename write cannot damage the prior record. */
  beforeRename?: (targetPath: string, temporaryPath: string) => void | Promise<void>;
}

export interface AppendUserMessageResult {
  conversation: DurableConversation;
  /** False when the stable message id had already been accepted with the same logical request. */
  appended: boolean;
}

interface StoreManifest {
  version: 1;
  host: { id: string; label: string };
}

interface WriterLock {
  version: 1;
  ownerToken: string;
  pid: number;
  hostname: string;
  heartbeat: string;
}

interface MutationResult<T> {
  result: T;
  changed: boolean;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function localProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(
  targetPath: string,
  value: unknown,
  beforeRename?: ConversationStoreOptions['beforeRename'],
): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(json(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeRename?.(targetPath, temporaryPath);
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function publicParticipants(conversation: DurableConversation): Participant[] {
  return conversation.participants.map((participant) => participant.kind === 'human' ? {
    id: participant.id,
    kind: participant.kind,
    displayName: participant.displayName,
  } : {
    id: participant.id,
    kind: participant.kind,
    displayName: participant.displayName,
    provider: participant.provider,
    role: participant.role,
    defaultMode: participant.defaultMode,
  });
}

export function publicConversation(conversation: DurableConversation): PublicConversation {
  const snapshot = {
    ...structuredClone(conversation),
    participants: publicParticipants(conversation),
  };
  return publicConversationSchema.parse(snapshot) as PublicConversation;
}

export function serverAgent(
  conversation: DurableConversation,
  participantId: string,
): ServerAgentParticipant | undefined {
  const participant = conversation.participants.find((item) => item.id === participantId);
  return participant?.kind === 'agent' ? participant : undefined;
}

export function primaryAttachment(conversation: Pick<DurableConversation, 'attachments'>): ProjectAttachment | undefined {
  return conversation.attachments.find((attachment) => attachment.role === 'primary');
}

export class ConversationStore {
  readonly storeDirectory: string;
  readonly threadsDirectory: string;
  readonly manifestPath: string;
  readonly lockPath: string;

  private readonly ownerToken = randomUUID();
  private readonly hostLabel: string;
  private readonly lockHostname: string;
  private readonly lockPid: number;
  private readonly now: () => Date;
  private readonly lockStaleMs: number;
  private readonly heartbeatMs: number;
  private readonly beforeRename?: ConversationStoreOptions['beforeRename'];
  private lockHandle?: FileHandle;
  private heartbeat?: ReturnType<typeof setInterval>;
  private manifest?: StoreManifest;
  private opening?: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly dataDirectory: string, options: ConversationStoreOptions = {}) {
    this.storeDirectory = path.join(dataDirectory, STORE_DIRECTORY);
    this.threadsDirectory = path.join(this.storeDirectory, 'threads');
    this.manifestPath = path.join(this.storeDirectory, 'manifest.json');
    this.lockPath = path.join(this.storeDirectory, 'writer.lock');
    this.hostLabel = options.hostLabel?.trim() || systemHostname();
    this.lockHostname = options.hostname?.trim() || systemHostname();
    this.lockPid = options.pid ?? process.pid;
    this.now = options.now || (() => new Date());
    this.lockStaleMs = options.lockStaleMs ?? LOCK_STALE_MS;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.beforeRename = options.beforeRename;
  }

  async host(): Promise<Readonly<StoreManifest['host']>> {
    await this.openStore();
    return { ...this.manifest!.host };
  }

  async listConversations(checkoutId?: string): Promise<DurableConversation[]> {
    await this.openStore();
    const entries = await readdir(this.threadsDirectory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (names.length > MAX_CONVERSATIONS) {
      throw new ConversationStoreError('corrupt', `Conversation store exceeds its ${MAX_CONVERSATIONS}-file safety bound.`);
    }
    const conversations = await Promise.all(names.map((name) => this.readConversationFile(path.join(this.threadsDirectory, name))));
    return conversations
      .filter((conversation) => !checkoutId || conversation.attachments.some((attachment) => attachment.checkoutId === checkoutId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getConversation(id: string): Promise<DurableConversation> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ConversationStoreError('unknown', 'Unknown conversation');
    await this.openStore();
    try {
      return await this.readConversationFile(this.conversationPath(id));
    } catch (error) {
      if (isMissing(error)) throw new ConversationStoreError('unknown', 'Unknown conversation');
      throw error;
    }
  }

  async createConversation(input: {
    checkoutId?: string;
    provider: AgentProvider;
    role?: AgentRole;
  }): Promise<DurableConversation> {
    return this.enqueue(async () => {
      await this.openStore();
      const currentCount = (await readdir(this.threadsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
      if (currentCount >= MAX_CONVERSATIONS) throw new Error(`A host can contain at most ${MAX_CONVERSATIONS} conversations.`);
      const now = this.now().toISOString();
      const id = randomUUID();
      const agentId = randomUUID();
      const role = input.role || 'coder';
      const conversation: DurableConversation = {
        version: STORE_VERSION,
        revision: 0,
        id,
        title: `Conversation ${currentCount + 1}`,
        attachments: input.checkoutId ? [{
          id: randomUUID(),
          hostId: this.manifest!.host.id,
          checkoutId: input.checkoutId,
          role: 'primary',
        }] : [],
        createdAt: now,
        updatedAt: now,
        primaryAgentId: agentId,
        participants: [
          { id: humanParticipantId(id), kind: 'human', displayName: 'You' },
          {
            id: agentId,
            kind: 'agent',
            displayName: PROVIDER_LABELS[input.provider],
            provider: input.provider,
            role,
            defaultMode: AGENT_ROLE_DEFAULT_MODES[role],
            session: { provider: input.provider, started: false },
          },
        ],
        messages: [],
        pinnedDiagramIds: [],
        annotations: {},
        sketches: [],
      };
      durableConversationSchema.parse(conversation);
      await this.writeConversation(conversation);
      return structuredClone(conversation);
    });
  }

  async appendUserMessage(id: string, message: UserMessage): Promise<AppendUserMessageResult> {
    return this.mutate<AppendUserMessageResult>(id, (conversation) => {
      const prior = conversation.messages.find((item) => item.id === message.id);
      if (prior) {
        const sameLogicalRequest = prior.role === 'user'
          && prior.authorId === message.authorId
          && prior.addressedParticipantId === message.addressedParticipantId
          && prior.text === message.text
          && prior.mode === message.mode
          && same(prior.diagramAttachments, message.diagramAttachments);
        if (!sameLogicalRequest) throw new Error('Message id was already used with different content');
        return { result: { conversation, appended: false }, changed: false };
      }
      const author = conversation.participants.find((participant) => participant.id === message.authorId);
      if (author?.kind !== 'human') throw new Error('The user message author is not a human in this conversation');
      if (!serverAgent(conversation, message.addressedParticipantId)) {
        throw new Error('The addressed participant is not an agent in this conversation');
      }
      conversation.messages.push(structuredClone(message));
      if (conversation.messages.length === 1) conversation.title = message.text.trim().slice(0, 56) || 'Sketch conversation';
      return { result: { conversation, appended: true }, changed: true };
    });
  }

  async failUserMessage(
    id: string,
    messageId: string,
    status: 'cancelled' | 'failed',
    delivery: 'not-sent' | 'possibly-sent',
  ): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      const message = conversation.messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'user') throw new Error('Unknown user message');
      if (message.status === status && message.delivery === delivery) return { result: conversation, changed: false };
      message.status = status;
      message.delivery = delivery;
      return { result: conversation, changed: true };
    });
  }

  /** Commits the assistant answer, user delivery state, and participant cursor in one revision. */
  async completeAssistantMessage(
    id: string,
    participantId: string,
    userMessageId: string,
    assistant: AssistantMessage,
  ): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      const prior = conversation.messages.find((message) => message.id === assistant.id);
      if (prior) {
        if (!same(prior, assistant)) throw new Error('Assistant message id was already used with different content');
        return { result: conversation, changed: false };
      }
      const participant = serverAgent(conversation, participantId);
      if (!participant || assistant.authorId !== participantId) throw new Error('Unknown assistant message author');
      const user = conversation.messages.find((message) => message.id === userMessageId);
      if (!user || user.role !== 'user' || user.addressedParticipantId !== participantId) {
        throw new Error('Unknown addressed user message');
      }
      user.status = 'sent';
      delete user.delivery;
      conversation.messages.push(structuredClone(assistant));
      participant.lastObservedMessageId = assistant.id;
      return { result: conversation, changed: true };
    });
  }

  async addAgent(
    id: string,
    provider: AgentProvider,
    role: AgentRole,
    requestId: string,
  ): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      const prior = conversation.participants.find((item): item is ServerAgentParticipant => (
        item.kind === 'agent' && item.creationRequestId === requestId
      ));
      if (prior) {
        if (prior.provider !== provider || prior.role !== role) {
          throw new Error('Participant request id was already used with different parameters');
        }
        return { result: conversation, changed: false };
      }
      if (conversation.participants.filter((item) => item.kind === 'agent').length >= 8) {
        throw new Error('A conversation can contain at most 8 agents');
      }
      const rootName = conversation.participants.some((item) => item.displayName === PROVIDER_LABELS[provider])
        ? `${PROVIDER_LABELS[provider]} ${AGENT_ROLE_LABELS[role]}`
        : PROVIDER_LABELS[provider];
      let displayName = rootName;
      let suffix = 2;
      while (conversation.participants.some((item) => item.displayName === displayName)) displayName = `${rootName} ${suffix++}`;
      conversation.participants.push({
        id: randomUUID(),
        kind: 'agent',
        displayName,
        provider,
        role,
        defaultMode: AGENT_ROLE_DEFAULT_MODES[role],
        session: { provider, started: false },
        creationRequestId: requestId,
      });
      return { result: conversation, changed: true };
    });
  }

  async setPrimaryAgent(id: string, participantId: string, expectedRevision: number): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      this.expectRevision(conversation, expectedRevision);
      if (!serverAgent(conversation, participantId)) throw new Error('The main participant must be an agent in this conversation');
      if (conversation.primaryAgentId === participantId) return { result: conversation, changed: false };
      conversation.primaryAgentId = participantId;
      return { result: conversation, changed: true };
    });
  }

  async putAnnotation(
    id: string,
    annotation: DiagramAnnotation,
    expectedRevision: number,
  ): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      this.expectRevision(conversation, expectedRevision);
      if (same(conversation.annotations[annotation.diagramId], annotation)) return { result: conversation, changed: false };
      conversation.annotations[annotation.diagramId] = structuredClone(annotation);
      return { result: conversation, changed: true };
    });
  }

  async createSketch(id: string, sketch: SketchCanvas): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      const prior = conversation.sketches.find((item) => item.id === sketch.id);
      if (prior) {
        if (!same(prior, sketch)) throw new Error('Sketch id was already used with different content');
        return { result: conversation, changed: false };
      }
      if (sketch.threadId !== id || sketch.ordinal !== conversation.sketches.length + 1) {
        throw new Error('Sketch identity or ordinal is invalid for this conversation');
      }
      conversation.sketches.push(structuredClone(sketch));
      return { result: conversation, changed: true };
    });
  }

  async setPins(id: string, pinnedDiagramIds: string[], expectedRevision: number): Promise<DurableConversation> {
    return this.mutate(id, (conversation) => {
      this.expectRevision(conversation, expectedRevision);
      if (same(conversation.pinnedDiagramIds, pinnedDiagramIds)) return { result: conversation, changed: false };
      conversation.pinnedDiagramIds = [...pinnedDiagramIds];
      return { result: conversation, changed: true };
    });
  }

  async markSessionStarted(
    id: string,
    participantId: string,
    provider: AgentProvider,
    sessionId: string,
  ): Promise<DurableConversation> {
    if (!sessionId.trim()) throw new Error('Agent initialized an invalid session');
    return this.mutate(id, (conversation) => {
      const participant = serverAgent(conversation, participantId);
      if (!participant) throw new Error('Unknown agent participant');
      if (participant.provider !== provider) throw new Error('Agent initialized the wrong provider session');
      if (participant.session.started && participant.session.sessionId !== sessionId) {
        throw new Error('Agent initialized an unexpected session');
      }
      const next = { provider, started: true as const, sessionId, hostId: this.manifest!.host.id };
      if (same(participant.session, next)) return { result: conversation, changed: false };
      participant.session = next;
      return { result: conversation, changed: true };
    });
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const handle = this.lockHandle;
    this.lockHandle = undefined;
    if (!handle) {
      this.opening = undefined;
      this.manifest = undefined;
      return;
    }
    await handle.close().catch(() => undefined);
    try {
      const current = writerLockSchema.parse(JSON.parse(await readFile(this.lockPath, 'utf8'))) as WriterLock;
      if (current.ownerToken === this.ownerToken) await unlink(this.lockPath);
    } catch {
      // A stale owner must never remove a successor's lock, and a missing lock is already released.
    }
    this.opening = undefined;
    this.manifest = undefined;
  }

  private conversationPath(id: string): string {
    return path.join(this.threadsDirectory, `${id}.json`);
  }

  private expectRevision(conversation: DurableConversation, expectedRevision: number): void {
    if (conversation.revision !== expectedRevision) {
      throw new ConversationStoreError(
        'conflict',
        `Conversation changed on another client (expected revision ${expectedRevision}, current revision ${conversation.revision}). Refetch and retry.`,
      );
    }
  }

  private async readConversationFile(filePath: string): Promise<DurableConversation> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if (isMissing(error)) throw error;
      throw new ConversationStoreError(
        'corrupt',
        `Conversation store contains an unreadable thread file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    const result = durableConversationSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConversationStoreError(
        'corrupt',
        `Conversation store contains an invalid thread file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    return result.data as DurableConversation;
  }

  private async writeConversation(conversation: DurableConversation): Promise<void> {
    durableConversationSchema.parse(conversation);
    await atomicWrite(this.conversationPath(conversation.id), conversation, this.beforeRename);
  }

  private async mutate<T>(
    id: string,
    operation: (conversation: DurableConversation) => MutationResult<T> | Promise<MutationResult<T>>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const conversation = await this.getConversation(id);
      const outcome = await operation(conversation);
      if (outcome.changed) {
        conversation.revision += 1;
        conversation.updatedAt = this.now().toISOString();
        await this.writeConversation(conversation);
      }
      return structuredClone(outcome.result);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async openStore(): Promise<void> {
    if (this.manifest && this.lockHandle) return;
    this.opening ??= this.initialize().catch(async (error) => {
      this.opening = undefined;
      await this.close();
      throw error;
    });
    await this.opening;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.dataDirectory, 0o700).catch(() => undefined);
    await mkdir(this.storeDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.storeDirectory, 0o700);
    await this.acquireWriterLock();

    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
    } catch (error) {
      if (!isMissing(error)) {
        throw new ConversationStoreError(
          'corrupt',
          `Conversation store manifest is invalid. Restore the whole ${STORE_DIRECTORY} directory from backup.`,
        );
      }
      const entries = await readdir(this.storeDirectory, { withFileTypes: true });
      const threadsExist = await readdir(this.threadsDirectory).then((items) => items.length > 0).catch(() => false);
      if (threadsExist || entries.some((entry) => entry.name !== 'writer.lock' && entry.name !== 'threads')) {
        throw new ConversationStoreError(
          'corrupt',
          `Conversation store identity is missing while data survives. Restore the whole ${STORE_DIRECTORY} directory (including manifest.json) from backup.`,
        );
      }
      const manifest: StoreManifest = {
        version: STORE_VERSION,
        host: { id: randomUUID(), label: this.hostLabel },
      };
      await atomicWrite(this.manifestPath, manifest, this.beforeRename);
      parsedManifest = manifest;
    }

    const manifest = manifestSchema.safeParse(parsedManifest);
    if (!manifest.success) {
      throw new ConversationStoreError(
        'corrupt',
        `Conversation store manifest is invalid. Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    this.manifest = manifest.data as StoreManifest;
    await mkdir(this.threadsDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.threadsDirectory, 0o700);
  }

  private lockRecord(): WriterLock {
    return {
      version: STORE_VERSION,
      ownerToken: this.ownerToken,
      pid: this.lockPid,
      hostname: this.lockHostname,
      heartbeat: this.now().toISOString(),
    };
  }

  private async acquireWriterLock(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const handle = await open(this.lockPath, 'wx+', 0o600);
        this.lockHandle = handle;
        await this.writeHeartbeat();
        this.heartbeat = setInterval(() => { void this.writeHeartbeat().catch(() => undefined); }, this.heartbeatMs);
        this.heartbeat.unref?.();
        return;
      } catch (error) {
        if (!isExists(error)) throw error;
      }

      const existing = await this.readExistingLock();
      const ownerIsDead = existing?.hostname === this.lockHostname && !localProcessIsAlive(existing.pid);
      if (existing && !ownerIsDead && this.now().getTime() - Date.parse(existing.heartbeat) <= this.lockStaleMs) {
        throw new ConversationStoreError(
          'locked',
          `Conversation store is already open by pid ${existing.pid} on ${existing.hostname} (heartbeat ${existing.heartbeat}).`,
        );
      }
      const staleName = path.join(this.storeDirectory, `.writer.lock.stale-${existing?.ownerToken || randomUUID()}`);
      try {
        await rename(this.lockPath, staleName);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      await unlink(staleName).catch(() => undefined);
    }
    throw new ConversationStoreError('locked', 'Conversation store lock changed repeatedly; retry after the other writer stops.');
  }

  private async readExistingLock(): Promise<WriterLock | undefined> {
    try {
      const raw = await readFile(this.lockPath, 'utf8');
      const parsed = writerLockSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data as WriterLock;
    } catch (error) {
      if (isMissing(error)) return undefined;
    }
    const metadata = await stat(this.lockPath).catch(() => undefined);
    if (metadata && this.now().getTime() - metadata.mtimeMs <= this.lockStaleMs) {
      throw new ConversationStoreError('locked', 'Conversation store has a recent unreadable writer lock; retry after its owner exits.');
    }
    return undefined;
  }

  private async writeHeartbeat(): Promise<void> {
    if (!this.lockHandle) return;
    const contents = json(this.lockRecord());
    await this.lockHandle.write(contents, 0, 'utf8');
    await this.lockHandle.truncate(Buffer.byteLength(contents));
    await this.lockHandle.sync();
  }
}

type ConversationStoreGlobal = typeof globalThis & {
  __codeAiConversationStores?: Map<string, ConversationStore>;
};

/** Route handlers are compiled separately; this map makes the writer queue process-wide. */
export function getConversationStore(
  dataDirectory: string,
  hostLabel?: string,
): ConversationStore {
  const scope = globalThis as ConversationStoreGlobal;
  const stores = (scope.__codeAiConversationStores ??= new Map());
  let store = stores.get(dataDirectory);
  if (!store) {
    store = new ConversationStore(dataDirectory, { hostLabel });
    stores.set(dataDirectory, store);
  }
  return store;
}

export function conversationStoreStatus(error: unknown): number {
  // Route handlers may be compiled into separate bundles, so an error thrown by the process-wide
  // store is not guaranteed to share this bundle's class identity.
  const code = error instanceof Error && error.name === 'ConversationStoreError'
    ? (error as ConversationStoreError).code
    : undefined;
  if (!code) return 400;
  if (code === 'unknown') return 404;
  if (code === 'conflict' || code === 'locked') return 409;
  return 500;
}
