import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentProvider, AgentRole, Participant, ProviderSessionRef, ServerAgentParticipant, ServerThread,
} from '@/shared/types';
import {
  AGENT_ROLE_DEFAULT_MODES, AGENT_ROLE_LABELS, PROVIDER_LABELS, humanParticipantId, legacyAgentParticipantId,
} from '@/shared/participants';

interface RegistryFile {
  version: 3;
  threads: ServerThread[];
}

interface V2ServerThread extends Omit<ServerThread, 'participants' | 'primaryAgentId'> {
  agent: ProviderSessionRef;
}

interface V2RegistryFile {
  version: 2;
  threads: V2ServerThread[];
}

interface V1ServerThread extends Omit<V2ServerThread, 'agent'> {
  claudeSessionStarted: boolean;
}

interface V1RegistryFile {
  version: 1;
  threads: V1ServerThread[];
}

function validSession(value: unknown): value is ProviderSessionRef {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return ['claude', 'codex'].includes(String(session.provider))
    && typeof session.started === 'boolean'
    && (session.sessionId === undefined || typeof session.sessionId === 'string')
    && (session.started !== true || typeof session.sessionId === 'string');
}

function validParticipant(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.displayName !== 'string') return false;
  if (item.kind === 'human') return true;
  return item.kind === 'agent'
    && ['claude', 'codex'].includes(String(item.provider))
    && ['orchestrator', 'coder', 'reviewer', 'tester', 'custom'].includes(String(item.role))
    && ['ask', 'plan', 'agent'].includes(String(item.defaultMode))
    && validSession(item.session)
    && item.session.provider === item.provider
    && (item.lastObservedMessageId === undefined || typeof item.lastObservedMessageId === 'string')
    && (item.creationRequestId === undefined || typeof item.creationRequestId === 'string');
}

function validThread(value: unknown): value is ServerThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id)
    || typeof item.projectId !== 'string' || typeof item.createdAt !== 'string'
    || typeof item.updatedAt !== 'string' || !Array.isArray(item.participants)
    || !item.participants.every(validParticipant) || typeof item.primaryAgentId !== 'string') return false;
  const participants = item.participants as Array<Record<string, unknown>>;
  const ids = participants.map((participant) => participant.id);
  const names = participants.map((participant) => participant.displayName);
  return new Set(ids).size === ids.length
    && new Set(names).size === names.length
    && participants.filter((participant) => participant.kind === 'human').length === 1
    && participants.some((participant) => participant.kind === 'agent' && participant.id === item.primaryAgentId);
}

function validV2Thread(value: unknown): value is V2ServerThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && /^[0-9a-f-]{36}$/i.test(item.id)
    && typeof item.projectId === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && validSession(item.agent);
}

function validV1Thread(value: unknown): value is V1ServerThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && /^[0-9a-f-]{36}$/i.test(item.id)
    && typeof item.projectId === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && typeof item.claudeSessionStarted === 'boolean';
}

function migrateV2Thread(thread: V2ServerThread): ServerThread {
  const agentId = legacyAgentParticipantId(thread.id);
  const agent: ServerAgentParticipant = {
    id: agentId,
    kind: 'agent',
    displayName: PROVIDER_LABELS[thread.agent.provider],
    provider: thread.agent.provider,
    role: 'coder',
    defaultMode: 'ask',
    session: thread.agent,
  };
  const { agent: _legacyAgent, ...base } = thread;
  return {
    ...base,
    participants: [{ id: humanParticipantId(thread.id), kind: 'human', displayName: 'You' }, agent],
    primaryAgentId: agentId,
  };
}

export function publicParticipants(thread: ServerThread): Participant[] {
  return thread.participants.map((participant) => participant.kind === 'human' ? {
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

export function serverAgent(thread: ServerThread, participantId: string): ServerAgentParticipant | undefined {
  const participant = thread.participants.find((item) => item.id === participantId);
  return participant?.kind === 'agent' ? participant : undefined;
}

export class ThreadRegistry {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'threads.json');
  }

  private async read(): Promise<RegistryFile> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700).catch(() => undefined);
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as RegistryFile | V2RegistryFile | V1RegistryFile;
      if (parsed.version === 3 && Array.isArray(parsed.threads) && parsed.threads.every(validThread)) return parsed;
      if (parsed.version === 2 && Array.isArray(parsed.threads) && parsed.threads.every(validV2Thread)) {
        return { version: 3, threads: parsed.threads.map(migrateV2Thread) };
      }
      if (parsed.version === 1 && Array.isArray(parsed.threads) && parsed.threads.every(validV1Thread)) {
        return {
          version: 3,
          threads: parsed.threads.map(({ claudeSessionStarted, ...thread }) => migrateV2Thread({
            ...thread,
            agent: {
              provider: 'claude',
              started: claudeSessionStarted,
              sessionId: claudeSessionStarted ? thread.id : undefined,
            },
          })),
        };
      }
      throw new Error('Thread registry has an unsupported or invalid format');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 3, threads: [] };
      throw error;
    }
  }

  private async write(data: RegistryFile): Promise<void> {
    const temporary = path.join(this.dataDir, `.threads-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  private mutate<T>(operation: (data: RegistryFile) => T | Promise<T>): Promise<T> {
    const result = this.writeQueue.then(async () => {
      const data = await this.read();
      const value = await operation(data);
      await this.write(data);
      return value;
    });
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async create(projectId: string, provider: AgentProvider, role: AgentRole = 'coder'): Promise<ServerThread> {
    return this.mutate((data) => {
      const now = new Date().toISOString();
      const id = randomUUID();
      const agentId = randomUUID();
      const thread: ServerThread = {
        id,
        projectId,
        createdAt: now,
        updatedAt: now,
        primaryAgentId: agentId,
        participants: [
          { id: humanParticipantId(id), kind: 'human', displayName: 'You' },
          {
            id: agentId,
            kind: 'agent',
            displayName: PROVIDER_LABELS[provider],
            provider,
            role,
            defaultMode: AGENT_ROLE_DEFAULT_MODES[role],
            session: { provider, started: false },
          },
        ],
      };
      data.threads.push(thread);
      return thread;
    });
  }

  async get(id: string, projectId?: string): Promise<ServerThread> {
    const thread = (await this.read()).threads.find((item) => item.id === id);
    if (!thread || (projectId && thread.projectId !== projectId)) throw new Error('Unknown project-bound thread');
    return thread;
  }

  async addAgent(
    id: string,
    projectId: string,
    provider: AgentProvider,
    role: AgentRole,
    requestId: string,
  ): Promise<ServerAgentParticipant> {
    return this.mutate((data) => {
      const thread = data.threads.find((item) => item.id === id && item.projectId === projectId);
      if (!thread) throw new Error('Unknown project-bound thread');
      const prior = thread.participants.find((item): item is ServerAgentParticipant => (
        item.kind === 'agent' && item.creationRequestId === requestId
      ));
      if (prior) {
        if (prior.provider !== provider || prior.role !== role) {
          throw new Error('Participant request id was already used with different parameters');
        }
        return prior;
      }
      if (thread.participants.filter((item) => item.kind === 'agent').length >= 8) {
        throw new Error('A conversation can contain at most 8 agents');
      }
      const rootName = thread.participants.some((item) => item.displayName === PROVIDER_LABELS[provider])
        ? `${PROVIDER_LABELS[provider]} ${AGENT_ROLE_LABELS[role]}`
        : PROVIDER_LABELS[provider];
      let displayName = rootName;
      let suffix = 2;
      while (thread.participants.some((item) => item.displayName === displayName)) displayName = `${rootName} ${suffix++}`;
      const participant: ServerAgentParticipant = {
        id: randomUUID(),
        kind: 'agent',
        displayName,
        provider,
        role,
        defaultMode: AGENT_ROLE_DEFAULT_MODES[role],
        session: { provider, started: false },
        creationRequestId: requestId,
      };
      thread.participants.push(participant);
      thread.updatedAt = new Date().toISOString();
      return participant;
    });
  }

  async setPrimaryAgent(id: string, projectId: string, participantId: string): Promise<void> {
    await this.mutate((data) => {
      const thread = data.threads.find((item) => item.id === id && item.projectId === projectId);
      if (!thread) throw new Error('Unknown project-bound thread');
      if (!serverAgent(thread, participantId)) throw new Error('The main participant must be an agent in this thread');
      thread.primaryAgentId = participantId;
      thread.updatedAt = new Date().toISOString();
    });
  }

  async markSessionStarted(id: string, participantId: string, provider: AgentProvider, sessionId: string): Promise<void> {
    if (!sessionId.trim()) throw new Error('Agent initialized an invalid session');
    await this.mutate((data) => {
      const thread = data.threads.find((item) => item.id === id);
      if (!thread) throw new Error('Unknown thread');
      const participant = serverAgent(thread, participantId);
      if (!participant) throw new Error('Unknown agent participant');
      if (participant.provider !== provider) throw new Error('Agent initialized the wrong provider session');
      if (participant.session.sessionId && participant.session.sessionId !== sessionId) {
        throw new Error('Agent initialized an unexpected session');
      }
      participant.session = { provider, sessionId, started: true };
      thread.updatedAt = new Date().toISOString();
    });
  }

  async markObserved(id: string, participantId: string, messageId: string): Promise<void> {
    await this.mutate((data) => {
      const thread = data.threads.find((item) => item.id === id);
      if (!thread) throw new Error('Unknown thread');
      const participant = serverAgent(thread, participantId);
      if (!participant) throw new Error('Unknown agent participant');
      participant.lastObservedMessageId = messageId;
      thread.updatedAt = new Date().toISOString();
    });
  }
}

let singleton: ThreadRegistry | undefined;
let singletonDir: string | undefined;

export function getThreadRegistry(dataDir: string): ThreadRegistry {
  if (!singleton || singletonDir !== dataDir) {
    singleton = new ThreadRegistry(dataDir);
    singletonDir = dataDir;
  }
  return singleton;
}
