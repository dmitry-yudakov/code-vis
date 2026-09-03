import { randomUUID } from 'node:crypto';
import { hostname as systemHostname } from 'node:os';
import {
  chmod, mkdir, open, readFile, readdir, rename, rm, stat, unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  AgentProvider, AgentRole, ArenaSessionSummary, AssistantMessage, DiagramAnnotation, DurableProject, DurableSession,
  Participant, PublicSession, RepositoryBinding, ServerAgentParticipant, SketchCanvas, UserMessage,
} from '@/shared/types';
import {
  durableProjectSchema, durableSessionSchema, legacyDurableSessionSchema,
  previousDurableSessionSchema, publicSessionSchema,
} from '@/shared/sessionSchema';
import {
  AGENT_ROLE_DEFAULT_MODES, AGENT_ROLE_LABELS, PROVIDER_LABELS, humanParticipantId,
} from '@/shared/participants';

const STORE_FORMAT_VERSION = 1;
const SESSION_RECORD_VERSION = 3;
const PROJECT_RECORD_VERSION = 1;
const STORE_DIRECTORY = 'session-store-v2';
const PREVIOUS_STORE_DIRECTORY = 'session-store-v1';
const LEGACY_STORE_DIRECTORY = 'conversation-store-v1';
const LEGACY_RECORDS_DIRECTORY = ['th', 'reads'].join('');
const LOCK_STALE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const MAX_SESSIONS = 1_000;
const MAX_PROJECTS = 1_000;

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

export type SessionStoreErrorCode = 'unknown' | 'conflict' | 'locked' | 'corrupt';

export class SessionStoreError extends Error {
  constructor(public readonly code: SessionStoreErrorCode, message: string) {
    super(message);
    this.name = 'SessionStoreError';
  }
}

export interface SessionStoreOptions {
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
  session: DurableSession;
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
  beforeRename?: SessionStoreOptions['beforeRename'],
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

export function publicParticipants(session: DurableSession): Participant[] {
  return session.participants.map((participant) => participant.kind === 'human' ? {
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

export function publicSession(session: DurableSession): PublicSession {
  const snapshot = {
    ...structuredClone(session),
    participants: publicParticipants(session),
  };
  return publicSessionSchema.parse(snapshot) as PublicSession;
}

/** The Arena polls this bounded projection; full transcripts stay behind the session routes. */
export function arenaSessionSummary(session: DurableSession): ArenaSessionSummary {
  const latest = session.messages.at(-1);
  return {
    id: session.id,
    revision: session.revision,
    title: session.title,
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.projectId ? { projectId: session.projectId } : {}),
    repositoryCheckoutIds: session.repositories.map((repository) => repository.checkoutId),
    agents: session.participants.flatMap((participant) => participant.kind === 'agent' ? [{
      id: participant.id,
      displayName: participant.displayName,
      provider: participant.provider,
      role: participant.role,
    }] : []),
    updatedAt: session.updatedAt,
    ...(latest ? {
      lastActivity: {
        messageId: latest.id,
        createdAt: latest.createdAt,
        status: latest.status,
      },
    } : {}),
  };
}

export function serverAgent(
  session: DurableSession,
  participantId: string,
): ServerAgentParticipant | undefined {
  const participant = session.participants.find((item) => item.id === participantId);
  return participant?.kind === 'agent' ? participant : undefined;
}

export function primaryRepository(
  session: Pick<DurableSession, 'repositories'>,
): RepositoryBinding | undefined {
  return session.repositories.find((repository) => repository.role === 'primary');
}

export class SessionStore {
  readonly storeDirectory: string;
  readonly sessionsDirectory: string;
  readonly archivedSessionsDirectory: string;
  readonly projectsDirectory: string;
  readonly manifestPath: string;
  readonly lockPath: string;

  private readonly ownerToken = randomUUID();
  private readonly hostLabel: string;
  private readonly lockHostname: string;
  private readonly lockPid: number;
  private readonly now: () => Date;
  private readonly lockStaleMs: number;
  private readonly heartbeatMs: number;
  private readonly beforeRename?: SessionStoreOptions['beforeRename'];
  private lockHandle?: FileHandle;
  private heartbeat?: ReturnType<typeof setInterval>;
  private manifest?: StoreManifest;
  private opening?: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly dataDirectory: string, options: SessionStoreOptions = {}) {
    this.storeDirectory = path.join(dataDirectory, STORE_DIRECTORY);
    this.sessionsDirectory = path.join(this.storeDirectory, 'sessions');
    this.archivedSessionsDirectory = path.join(this.storeDirectory, 'archived-sessions');
    this.projectsDirectory = path.join(this.storeDirectory, 'projects');
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

  async listProjects(): Promise<DurableProject[]> {
    await this.openStore();
    const entries = await readdir(this.projectsDirectory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (names.length > MAX_PROJECTS) {
      throw new SessionStoreError('corrupt', `Project store exceeds its ${MAX_PROJECTS}-file safety bound.`);
    }
    const projects = await Promise.all(names.map((name) => this.readProjectFile(path.join(this.projectsDirectory, name))));
    return projects.sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)
    ));
  }

  async getProject(id: string): Promise<DurableProject> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SessionStoreError('unknown', 'Unknown project');
    await this.openStore();
    try {
      return await this.readProjectFile(this.projectPath(id));
    } catch (error) {
      if (isMissing(error)) throw new SessionStoreError('unknown', 'Unknown project');
      throw error;
    }
  }

  async createProject(name: string, checkoutIds: string[] = []): Promise<DurableProject> {
    return this.enqueue(async () => {
      await this.openStore();
      const currentCount = (await readdir(this.projectsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
      if (currentCount >= MAX_PROJECTS) throw new Error(`A host can contain at most ${MAX_PROJECTS} projects.`);
      if (new Set(checkoutIds).size !== checkoutIds.length) throw new Error('A repository may be added to a project only once.');
      const now = this.now().toISOString();
      const project: DurableProject = {
        version: PROJECT_RECORD_VERSION,
        revision: 0,
        id: randomUUID(),
        name: name.trim(),
        repositories: checkoutIds.map((checkoutId, index) => ({
          id: randomUUID(),
          hostId: this.manifest!.host.id,
          checkoutId,
          role: index === 0 ? 'primary' : 'reference',
        })),
        createdAt: now,
        updatedAt: now,
      };
      durableProjectSchema.parse(project);
      await this.writeProject(project);
      return structuredClone(project);
    });
  }

  async updateProject(id: string, input: {
    expectedRevision: number;
    name?: string;
    repositories?: RepositoryBinding[];
  }): Promise<DurableProject> {
    return this.enqueue(async () => {
      const project = await this.getProject(id);
      this.expectProjectRevision(project, input.expectedRevision);
      const before = structuredClone(project);
      if (input.name !== undefined) project.name = input.name.trim();
      if (input.repositories !== undefined) project.repositories = structuredClone(input.repositories);
      if (same(before, project)) return structuredClone(project);
      const next = structuredClone(project);
      next.revision += 1;
      next.updatedAt = this.now().toISOString();
      durableProjectSchema.parse(next);
      await this.writeProject(next);
      return structuredClone(next);
    });
  }

  async deleteProject(id: string, expectedRevision: number): Promise<{ detachedSessionCount: number }> {
    return this.enqueue(async () => {
      const project = await this.getProject(id);
      this.expectProjectRevision(project, expectedRevision);
      const [activeSessions, archivedSessions] = await Promise.all([
        this.listSessions(),
        this.listArchivedSessions(),
      ]);
      const sessions = [...activeSessions, ...archivedSessions].filter((session) => session.projectId === id);
      const updatedAt = this.now().toISOString();
      for (const session of sessions) {
        delete session.projectId;
        session.revision += 1;
        session.updatedAt = updatedAt;
        durableSessionSchema.parse(session);
      }
      for (const session of sessions) {
        if (session.archivedAt) await this.writeArchivedSession(session);
        else await this.writeSession(session);
      }
      await unlink(this.projectPath(id));
      await syncDirectory(this.projectsDirectory);
      return { detachedSessionCount: sessions.length };
    });
  }

  async listSessions(filter: { projectId?: string; loose?: boolean } = {}): Promise<DurableSession[]> {
    await this.openStore();
    const sessions = await this.listSessionDirectory(this.sessionsDirectory, false);
    return sessions
      .filter((session) => (
        filter.loose ? !session.projectId : !filter.projectId || session.projectId === filter.projectId
      ))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listArchivedSessions(filter: { projectId?: string; loose?: boolean } = {}): Promise<DurableSession[]> {
    await this.openStore();
    const sessions = await this.listSessionDirectory(this.archivedSessionsDirectory, true);
    return sessions
      .filter((session) => (
        filter.loose ? !session.projectId : !filter.projectId || session.projectId === filter.projectId
      ))
      .sort((left, right) => (
        (right.archivedAt || right.updatedAt).localeCompare(left.archivedAt || left.updatedAt)
      ));
  }

  async getSession(id: string): Promise<DurableSession> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SessionStoreError('unknown', 'Unknown session');
    await this.openStore();
    try {
      const session = await this.readSessionFile(this.sessionPath(id));
      if (session.archivedAt) throw new SessionStoreError('unknown', 'Unknown session');
      return session;
    } catch (error) {
      if (isMissing(error)) throw new SessionStoreError('unknown', 'Unknown session');
      throw error;
    }
  }

  async getArchivedSession(id: string): Promise<DurableSession> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SessionStoreError('unknown', 'Unknown archived session');
    await this.openStore();
    try {
      const session = await this.readSessionFile(this.archivedSessionPath(id));
      if (!session.archivedAt) throw new SessionStoreError('unknown', 'Unknown archived session');
      return session;
    } catch (error) {
      if (isMissing(error)) throw new SessionStoreError('unknown', 'Unknown archived session');
      throw error;
    }
  }

  async archiveSession(id: string, expectedRevision: number): Promise<DurableSession> {
    return this.enqueue(async () => {
      const session = await this.getSession(id);
      this.expectRevision(session, expectedRevision);
      await this.expectNoSessionAt(this.archivedSessionPath(id), 'Archive already contains this session.');
      const archived = structuredClone(session);
      archived.archivedAt = this.now().toISOString();
      archived.updatedAt = archived.archivedAt;
      archived.revision += 1;
      durableSessionSchema.parse(archived);
      // The marker is written before the move so startup can finish an interrupted transition.
      await atomicWrite(this.sessionPath(id), archived, this.beforeRename);
      try {
        await rename(this.sessionPath(id), this.archivedSessionPath(id));
      } catch (error) {
        await atomicWrite(this.sessionPath(id), session, this.beforeRename).catch(() => undefined);
        throw error;
      }
      await Promise.all([syncDirectory(this.sessionsDirectory), syncDirectory(this.archivedSessionsDirectory)]);
      return structuredClone(archived);
    });
  }

  async restoreSession(id: string, expectedRevision: number): Promise<DurableSession> {
    return this.enqueue(async () => {
      const session = await this.getArchivedSession(id);
      this.expectRevision(session, expectedRevision);
      await this.expectNoSessionAt(this.sessionPath(id), 'Active sessions already contain this session.');
      const restored = structuredClone(session);
      delete restored.archivedAt;
      restored.updatedAt = this.now().toISOString();
      restored.revision += 1;
      durableSessionSchema.parse(restored);
      // Clearing the marker first lets startup finish an interrupted restore in the safe direction.
      await atomicWrite(this.archivedSessionPath(id), restored, this.beforeRename);
      try {
        await rename(this.archivedSessionPath(id), this.sessionPath(id));
      } catch (error) {
        await atomicWrite(this.archivedSessionPath(id), session, this.beforeRename).catch(() => undefined);
        throw error;
      }
      await Promise.all([syncDirectory(this.archivedSessionsDirectory), syncDirectory(this.sessionsDirectory)]);
      return structuredClone(restored);
    });
  }

  async createSession(input: {
    projectId?: string;
    provider: AgentProvider;
    role?: AgentRole;
  }): Promise<DurableSession> {
    return this.enqueue(async () => {
      await this.openStore();
      const currentCount = (await Promise.all([
        this.sessionFileNames(this.sessionsDirectory),
        this.sessionFileNames(this.archivedSessionsDirectory),
      ])).reduce((total, names) => total + names.length, 0);
      if (currentCount >= MAX_SESSIONS) throw new Error(`A host can contain at most ${MAX_SESSIONS} sessions.`);
      const now = this.now().toISOString();
      const id = randomUUID();
      const agentId = randomUUID();
      const role = input.role || 'coder';
      const project = input.projectId ? await this.getProject(input.projectId) : undefined;
      const session: DurableSession = {
        version: SESSION_RECORD_VERSION,
        revision: 0,
        id,
        title: `Session ${currentCount + 1}`,
        ...(project ? { projectId: project.id } : {}),
        repositories: structuredClone(project?.repositories || []),
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
      durableSessionSchema.parse(session);
      await this.writeSession(session);
      return structuredClone(session);
    });
  }

  async appendUserMessage(id: string, message: UserMessage): Promise<AppendUserMessageResult> {
    return this.mutate<AppendUserMessageResult>(id, (session) => {
      const prior = session.messages.find((item) => item.id === message.id);
      if (prior) {
        const sameLogicalRequest = prior.role === 'user'
          && prior.authorId === message.authorId
          && prior.addressedParticipantId === message.addressedParticipantId
          && prior.text === message.text
          && prior.mode === message.mode
          && same(prior.diagramAttachments, message.diagramAttachments);
        if (!sameLogicalRequest) throw new Error('Message id was already used with different content');
        return { result: { session, appended: false }, changed: false };
      }
      const author = session.participants.find((participant) => participant.id === message.authorId);
      if (author?.kind !== 'human') throw new Error('The user message author is not a human in this session');
      if (!serverAgent(session, message.addressedParticipantId)) {
        throw new Error('The addressed participant is not an agent in this session');
      }
      session.messages.push(structuredClone(message));
      if (session.messages.length === 1) session.title = message.text.trim().slice(0, 56) || 'Sketch session';
      return { result: { session, appended: true }, changed: true };
    });
  }

  async failUserMessage(
    id: string,
    messageId: string,
    status: 'cancelled' | 'failed',
    delivery: 'not-sent' | 'possibly-sent',
  ): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      const message = session.messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'user') throw new Error('Unknown user message');
      if (message.status === status && message.delivery === delivery) return { result: session, changed: false };
      message.status = status;
      message.delivery = delivery;
      return { result: session, changed: true };
    });
  }

  /** Commits the assistant answer, user delivery state, and participant cursor in one revision. */
  async completeAssistantMessage(
    id: string,
    participantId: string,
    userMessageId: string,
    assistant: AssistantMessage,
  ): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      const prior = session.messages.find((message) => message.id === assistant.id);
      if (prior) {
        if (!same(prior, assistant)) throw new Error('Assistant message id was already used with different content');
        return { result: session, changed: false };
      }
      const participant = serverAgent(session, participantId);
      if (!participant || assistant.authorId !== participantId) throw new Error('Unknown assistant message author');
      const user = session.messages.find((message) => message.id === userMessageId);
      if (!user || user.role !== 'user' || user.addressedParticipantId !== participantId) {
        throw new Error('Unknown addressed user message');
      }
      user.status = 'sent';
      delete user.delivery;
      session.messages.push(structuredClone(assistant));
      participant.lastObservedMessageId = assistant.id;
      return { result: session, changed: true };
    });
  }

  async addAgent(
    id: string,
    provider: AgentProvider,
    role: AgentRole,
    requestId: string,
  ): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      const prior = session.participants.find((item): item is ServerAgentParticipant => (
        item.kind === 'agent' && item.creationRequestId === requestId
      ));
      if (prior) {
        if (prior.provider !== provider || prior.role !== role) {
          throw new Error('Participant request id was already used with different parameters');
        }
        return { result: session, changed: false };
      }
      if (session.participants.filter((item) => item.kind === 'agent').length >= 8) {
        throw new Error('A session can contain at most 8 agents');
      }
      const rootName = session.participants.some((item) => item.displayName === PROVIDER_LABELS[provider])
        ? `${PROVIDER_LABELS[provider]} ${AGENT_ROLE_LABELS[role]}`
        : PROVIDER_LABELS[provider];
      let displayName = rootName;
      let suffix = 2;
      while (session.participants.some((item) => item.displayName === displayName)) displayName = `${rootName} ${suffix++}`;
      session.participants.push({
        id: randomUUID(),
        kind: 'agent',
        displayName,
        provider,
        role,
        defaultMode: AGENT_ROLE_DEFAULT_MODES[role],
        session: { provider, started: false },
        creationRequestId: requestId,
      });
      return { result: session, changed: true };
    });
  }

  async setPrimaryAgent(id: string, participantId: string, expectedRevision: number): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      this.expectRevision(session, expectedRevision);
      if (!serverAgent(session, participantId)) throw new Error('The main participant must be an agent in this session');
      if (session.primaryAgentId === participantId) return { result: session, changed: false };
      session.primaryAgentId = participantId;
      return { result: session, changed: true };
    });
  }

  async putAnnotation(
    id: string,
    annotation: DiagramAnnotation,
    expectedRevision: number,
  ): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      this.expectRevision(session, expectedRevision);
      if (same(session.annotations[annotation.diagramId], annotation)) return { result: session, changed: false };
      session.annotations[annotation.diagramId] = structuredClone(annotation);
      return { result: session, changed: true };
    });
  }

  async createSketch(id: string, sketch: SketchCanvas): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      const prior = session.sketches.find((item) => item.id === sketch.id);
      if (prior) {
        if (!same(prior, sketch)) throw new Error('Sketch id was already used with different content');
        return { result: session, changed: false };
      }
      if (sketch.sessionId !== id || sketch.ordinal !== session.sketches.length + 1) {
        throw new Error('Sketch identity or ordinal is invalid for this session');
      }
      session.sketches.push(structuredClone(sketch));
      return { result: session, changed: true };
    });
  }

  async setPins(id: string, pinnedDiagramIds: string[], expectedRevision: number): Promise<DurableSession> {
    return this.mutate(id, (session) => {
      this.expectRevision(session, expectedRevision);
      if (same(session.pinnedDiagramIds, pinnedDiagramIds)) return { result: session, changed: false };
      session.pinnedDiagramIds = [...pinnedDiagramIds];
      return { result: session, changed: true };
    });
  }

  async setSessionRepositories(
    id: string,
    repositories: RepositoryBinding[],
    expectedRevision: number,
  ): Promise<DurableSession> {
    return this.enqueue(async () => {
      const session = await this.getSession(id);
      this.expectRevision(session, expectedRevision);
      const repositoriesChanged = !same(session.repositories, repositories);
      const updatedAt = this.now().toISOString();

      let nextProject: DurableProject | undefined;
      if (session.projectId) {
        const project = await this.getProject(session.projectId);
        const known = new Set(project.repositories.map((repository) => `${repository.hostId}\0${repository.checkoutId}`));
        const additions = repositories.filter((repository) => !known.has(`${repository.hostId}\0${repository.checkoutId}`));
        if (additions.length) {
          nextProject = structuredClone(project);
          for (const addition of additions) {
            nextProject.repositories.push({
              ...structuredClone(addition),
              role: nextProject.repositories.some((repository) => repository.role === 'primary')
                ? 'reference'
                : addition.role,
            });
          }
          nextProject.revision += 1;
          nextProject.updatedAt = updatedAt;
          durableProjectSchema.parse(nextProject);
        }
      }

      if (nextProject) await this.writeProject(nextProject);
      if (!repositoriesChanged) return structuredClone(session);

      const nextSession = structuredClone(session);
      nextSession.repositories = structuredClone(repositories);
      nextSession.revision += 1;
      nextSession.updatedAt = updatedAt;
      durableSessionSchema.parse(nextSession);
      await this.writeSession(nextSession);
      return structuredClone(nextSession);
    });
  }

  async markProviderSessionStarted(
    id: string,
    participantId: string,
    provider: AgentProvider,
    sessionId: string,
  ): Promise<DurableSession> {
    if (!sessionId.trim()) throw new Error('Agent initialized an invalid session');
    return this.mutate(id, (session) => {
      const participant = serverAgent(session, participantId);
      if (!participant) throw new Error('Unknown agent participant');
      if (participant.provider !== provider) throw new Error('Agent initialized the wrong provider session');
      if (participant.session.started && participant.session.sessionId !== sessionId) {
        throw new Error('Agent initialized an unexpected session');
      }
      const next = { provider, started: true as const, sessionId, hostId: this.manifest!.host.id };
      if (same(participant.session, next)) return { result: session, changed: false };
      participant.session = next;
      return { result: session, changed: true };
    });
  }

  async close(): Promise<void> {
    await this.releaseWriterLock();
    this.opening = undefined;
    this.manifest = undefined;
  }

  private async releaseWriterLock(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const handle = this.lockHandle;
    this.lockHandle = undefined;
    if (!handle) return;
    await handle.close().catch(() => undefined);
    try {
      const current = writerLockSchema.parse(JSON.parse(await readFile(this.lockPath, 'utf8'))) as WriterLock;
      if (current.ownerToken === this.ownerToken) await unlink(this.lockPath);
    } catch {
      // A stale owner must never remove a successor's lock, and a missing lock is already released.
    }
  }

  private sessionPath(id: string): string {
    return path.join(this.sessionsDirectory, `${id}.json`);
  }

  private archivedSessionPath(id: string): string {
    return path.join(this.archivedSessionsDirectory, `${id}.json`);
  }

  private projectPath(id: string): string {
    return path.join(this.projectsDirectory, `${id}.json`);
  }

  private expectRevision(session: DurableSession, expectedRevision: number): void {
    if (session.revision !== expectedRevision) {
      throw new SessionStoreError(
        'conflict',
        `Session changed on another client (expected revision ${expectedRevision}, current revision ${session.revision}). Refetch and retry.`,
      );
    }
  }

  private expectProjectRevision(project: DurableProject, expectedRevision: number): void {
    if (project.revision !== expectedRevision) {
      throw new SessionStoreError(
        'conflict',
        `Project changed on another client (expected revision ${expectedRevision}, current revision ${project.revision}). Refetch and retry.`,
      );
    }
  }

  private async readProjectFile(filePath: string): Promise<DurableProject> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if (isMissing(error)) throw error;
      throw new SessionStoreError(
        'corrupt',
        `Project store contains an unreadable project file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    const result = durableProjectSchema.safeParse(parsed);
    if (!result.success) {
      throw new SessionStoreError(
        'corrupt',
        `Project store contains an invalid project file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    return result.data as DurableProject;
  }

  private async readSessionFile(filePath: string): Promise<DurableSession> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if (isMissing(error)) throw error;
      throw new SessionStoreError(
        'corrupt',
        `Session store contains an unreadable session file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    const result = durableSessionSchema.safeParse(parsed);
    if (!result.success) {
      throw new SessionStoreError(
        'corrupt',
        `Session store contains an invalid session file (${path.basename(filePath)}). Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    return result.data as DurableSession;
  }

  private async writeSession(session: DurableSession): Promise<void> {
    durableSessionSchema.parse(session);
    await atomicWrite(this.sessionPath(session.id), session, this.beforeRename);
  }

  private async writeArchivedSession(session: DurableSession): Promise<void> {
    durableSessionSchema.parse(session);
    if (!session.archivedAt) throw new SessionStoreError('corrupt', 'An archived session requires archivedAt.');
    await atomicWrite(this.archivedSessionPath(session.id), session, this.beforeRename);
  }

  private async expectNoSessionAt(filePath: string, message: string): Promise<void> {
    const existing = await stat(filePath).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    if (existing) throw new SessionStoreError('corrupt', message);
  }

  private async sessionFileNames(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  private async listSessionDirectory(directory: string, archived: boolean): Promise<DurableSession[]> {
    const [activeNames, archivedNames] = await Promise.all([
      this.sessionFileNames(this.sessionsDirectory),
      this.sessionFileNames(this.archivedSessionsDirectory),
    ]);
    if (activeNames.length + archivedNames.length > MAX_SESSIONS) {
      throw new SessionStoreError('corrupt', `Session store exceeds its ${MAX_SESSIONS}-file safety bound.`);
    }
    const names = directory === this.sessionsDirectory ? activeNames : archivedNames;
    const sessions = await Promise.all(names.map((name) => this.readSessionFile(path.join(directory, name))));
    return sessions.filter((session) => archived ? Boolean(session.archivedAt) : !session.archivedAt);
  }

  private async writeProject(project: DurableProject): Promise<void> {
    durableProjectSchema.parse(project);
    await atomicWrite(this.projectPath(project.id), project, this.beforeRename);
  }

  private async mutate<T>(
    id: string,
    operation: (session: DurableSession) => MutationResult<T> | Promise<MutationResult<T>>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const session = await this.getSession(id);
      const outcome = await operation(session);
      if (outcome.changed) {
        session.revision += 1;
        session.updatedAt = this.now().toISOString();
        await this.writeSession(session);
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
    let createdStore = false;
    try {
      await mkdir(this.storeDirectory, { mode: 0o700 });
      createdStore = true;
    } catch (error) {
      if (!isExists(error)) throw error;
    }
    await chmod(this.storeDirectory, 0o700);

    try {
      await this.acquireWriterLock();
      if (createdStore) await this.initializeNewStore();
      else await this.openExistingStore();
    } catch (error) {
      if (createdStore) {
        await this.releaseWriterLock();
        await rm(this.storeDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  private async initializeNewStore(): Promise<void> {
    const previousStoreDirectory = path.join(this.dataDirectory, PREVIOUS_STORE_DIRECTORY);
    const legacyStoreDirectory = path.join(this.dataDirectory, LEGACY_STORE_DIRECTORY);
    const previousStore = await stat(previousStoreDirectory).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    const legacyStore = previousStore ? undefined : await stat(legacyStoreDirectory).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    const sourceStore = previousStore ? previousStoreDirectory : legacyStore ? legacyStoreDirectory : undefined;

    if (!sourceStore) {
      const manifest: StoreManifest = {
        version: STORE_FORMAT_VERSION,
        host: { id: randomUUID(), label: this.hostLabel },
      };
      await mkdir(this.sessionsDirectory, { mode: 0o700 });
      await mkdir(this.archivedSessionsDirectory, { mode: 0o700 });
      await mkdir(this.projectsDirectory, { mode: 0o700 });
      await atomicWrite(this.manifestPath, manifest, this.beforeRename);
      this.manifest = manifest;
      return;
    }
    if (!(previousStore || legacyStore)!.isDirectory()) {
      throw new SessionStoreError('corrupt', `${path.basename(sourceStore)} exists but is not a directory.`);
    }

    let parsedSourceManifest: unknown;
    try {
      parsedSourceManifest = JSON.parse(await readFile(path.join(sourceStore, 'manifest.json'), 'utf8'));
    } catch {
      throw new SessionStoreError('corrupt', `Previous session store manifest is invalid in ${path.basename(sourceStore)}.`);
    }
    const sourceManifest = manifestSchema.safeParse(parsedSourceManifest);
    if (!sourceManifest.success) {
      throw new SessionStoreError('corrupt', `Previous session store manifest is invalid in ${path.basename(sourceStore)}.`);
    }

    const sourceRecordsDirectory = previousStore
      ? path.join(previousStoreDirectory, 'sessions')
      : path.join(legacyStoreDirectory, LEGACY_RECORDS_DIRECTORY);
    const entries = await readdir(sourceRecordsDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    const names = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    if (names.length > MAX_SESSIONS) {
      throw new SessionStoreError('corrupt', `Previous session store exceeds its ${MAX_SESSIONS}-file safety bound.`);
    }

    await mkdir(this.sessionsDirectory, { mode: 0o700 });
    await mkdir(this.archivedSessionsDirectory, { mode: 0o700 });
    await mkdir(this.projectsDirectory, { mode: 0o700 });
    for (const name of names) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path.join(sourceRecordsDirectory, name), 'utf8'));
      } catch {
        throw new SessionStoreError('corrupt', `Previous session store contains an unreadable record (${name}).`);
      }
      const migrated = previousStore
        ? previousDurableSessionSchema.safeParse(parsed)
        : legacyDurableSessionSchema.safeParse(parsed);
      if (!migrated.success || name !== `${migrated.data.id}.json`) {
        throw new SessionStoreError('corrupt', `Previous session store contains an invalid record (${name}).`);
      }
      await atomicWrite(this.sessionPath(migrated.data.id), migrated.data, this.beforeRename);
    }

    const manifest = sourceManifest.data as StoreManifest;
    await atomicWrite(this.manifestPath, manifest, this.beforeRename);
    this.manifest = manifest;
    console.info(`CodeAI upgraded ${names.length} session record${names.length === 1 ? '' : 's'} from ${path.basename(sourceStore)} to ${STORE_DIRECTORY}.`);
  }

  private async openExistingStore(): Promise<void> {
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
    } catch {
      throw new SessionStoreError(
        'corrupt',
        `Session store manifest is invalid. Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    const manifest = manifestSchema.safeParse(parsedManifest);
    if (!manifest.success) {
      throw new SessionStoreError(
        'corrupt',
        `Session store manifest is invalid. Restore the whole ${STORE_DIRECTORY} directory from backup.`,
      );
    }
    this.manifest = manifest.data as StoreManifest;
    await mkdir(this.sessionsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(this.archivedSessionsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(this.projectsDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.sessionsDirectory, 0o700);
    await chmod(this.archivedSessionsDirectory, 0o700);
    await chmod(this.projectsDirectory, 0o700);
    await this.finishInterruptedSessionTransitions();
  }

  private async finishInterruptedSessionTransitions(): Promise<void> {
    const [activeNames, archivedNames] = await Promise.all([
      this.sessionFileNames(this.sessionsDirectory),
      this.sessionFileNames(this.archivedSessionsDirectory),
    ]);
    if (activeNames.length + archivedNames.length > MAX_SESSIONS) {
      throw new SessionStoreError('corrupt', `Session store exceeds its ${MAX_SESSIONS}-file safety bound.`);
    }
    const duplicate = activeNames.find((name) => archivedNames.includes(name));
    if (duplicate) {
      throw new SessionStoreError('corrupt', `Session exists in both active and archived storage (${duplicate}).`);
    }
    for (const name of activeNames) {
      const session = await this.readSessionFile(path.join(this.sessionsDirectory, name));
      if (session.archivedAt) await rename(this.sessionPath(session.id), this.archivedSessionPath(session.id));
    }
    for (const name of archivedNames) {
      const session = await this.readSessionFile(path.join(this.archivedSessionsDirectory, name));
      if (!session.archivedAt) await rename(this.archivedSessionPath(session.id), this.sessionPath(session.id));
    }
    await Promise.all([syncDirectory(this.sessionsDirectory), syncDirectory(this.archivedSessionsDirectory)]);
  }

  private lockRecord(): WriterLock {
    return {
      version: STORE_FORMAT_VERSION,
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
        throw new SessionStoreError(
          'locked',
          `Session store is already open by pid ${existing.pid} on ${existing.hostname} (heartbeat ${existing.heartbeat}).`,
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
    throw new SessionStoreError('locked', 'Session store lock changed repeatedly; retry after the other writer stops.');
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
      throw new SessionStoreError('locked', 'Session store has a recent unreadable writer lock; retry after its owner exits.');
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

type SessionStoreGlobal = typeof globalThis & {
  __codeAiSessionStores?: Map<string, SessionStore>;
};

/** Route handlers are compiled separately; this map makes the writer queue process-wide. */
export function getSessionStore(
  dataDirectory: string,
  hostLabel?: string,
): SessionStore {
  const scope = globalThis as SessionStoreGlobal;
  const stores = (scope.__codeAiSessionStores ??= new Map());
  let store = stores.get(dataDirectory);
  if (!store) {
    store = new SessionStore(dataDirectory, { hostLabel });
    stores.set(dataDirectory, store);
  }
  return store;
}

export function sessionStoreStatus(error: unknown): number {
  // Route handlers may be compiled into separate bundles, so an error thrown by the process-wide
  // store is not guaranteed to share this bundle's class identity.
  const code = error instanceof Error && error.name === 'SessionStoreError'
    ? (error as SessionStoreError).code
    : undefined;
  if (!code) return 400;
  if (code === 'unknown') return 404;
  if (code === 'conflict' || code === 'locked') return 409;
  return 500;
}
