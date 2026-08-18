import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider, ServerThread } from '@/lib/shared/types';

interface RegistryFile {
  version: 2;
  threads: ServerThread[];
}

interface LegacyServerThread extends Omit<ServerThread, 'agent'> {
  claudeSessionStarted: boolean;
}

interface LegacyRegistryFile {
  version: 1;
  threads: LegacyServerThread[];
}

function validThread(value: unknown): value is ServerThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && /^[0-9a-f-]{36}$/i.test(item.id)
    && typeof item.projectId === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && Boolean(item.agent && typeof item.agent === 'object')
    && ['claude', 'codex'].includes(String((item.agent as Record<string, unknown>).provider))
    && typeof (item.agent as Record<string, unknown>).started === 'boolean'
    && ((item.agent as Record<string, unknown>).sessionId === undefined
      || typeof (item.agent as Record<string, unknown>).sessionId === 'string')
    && ((item.agent as Record<string, unknown>).started !== true
      || typeof (item.agent as Record<string, unknown>).sessionId === 'string');
}

function validLegacyThread(value: unknown): value is LegacyServerThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && /^[0-9a-f-]{36}$/i.test(item.id)
    && typeof item.projectId === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && typeof item.claudeSessionStarted === 'boolean';
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
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as RegistryFile | LegacyRegistryFile;
      if (parsed.version === 2 && Array.isArray(parsed.threads) && parsed.threads.every(validThread)) return parsed;
      if (parsed.version === 1 && Array.isArray(parsed.threads) && parsed.threads.every(validLegacyThread)) {
        return {
          version: 2,
          threads: parsed.threads.map(({ claudeSessionStarted, ...thread }) => ({
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, threads: [] };
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

  async create(projectId: string, provider: AgentProvider): Promise<ServerThread> {
    return this.mutate((data) => {
      const now = new Date().toISOString();
      const thread: ServerThread = {
        id: randomUUID(), projectId, createdAt: now, updatedAt: now,
        agent: { provider, started: false },
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

  async markSessionStarted(id: string, provider: AgentProvider, sessionId: string): Promise<void> {
    if (!sessionId.trim()) throw new Error('Agent initialized an invalid session');
    await this.mutate((data) => {
      const thread = data.threads.find((item) => item.id === id);
      if (!thread) throw new Error('Unknown thread');
      if (thread.agent.provider !== provider) throw new Error('Agent initialized the wrong provider session');
      if (thread.agent.sessionId && thread.agent.sessionId !== sessionId) {
        throw new Error('Agent initialized an unexpected session');
      }
      thread.agent = { provider, sessionId, started: true };
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
