import { randomUUID } from 'node:crypto';
import {
  chmod, mkdir, open, readFile, rename, unlink, type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { executorSnapshotSchema } from '@/shared/machineSchema';
import type { ExecutorSnapshot, MachineIdentity } from '@/shared/types';

const REGISTRY_RECORD = 'machine-registry-v1.json';
const REGISTRY_VERSION = 1;
const MAX_MACHINES = 8;

const connectionSchema = z.object({
  machine: z.object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(200),
  }).strict(),
  origin: z.string().url().max(2_048),
  credential: z.string().min(60).max(180),
  expiresAt: z.string().datetime(),
  attachedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().optional(),
  cachedAt: z.string().datetime().optional(),
  cachedSnapshot: executorSnapshotSchema.optional(),
}).strict().superRefine((connection, ctx) => {
  const url = new URL(connection.origin);
  if (
    url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.origin !== connection.origin
  ) {
    ctx.addIssue({ code: 'custom', message: 'Machine origin must be an exact HTTPS origin.', path: ['origin'] });
  }
  if (connection.cachedSnapshot && connection.cachedSnapshot.machine.id !== connection.machine.id) {
    ctx.addIssue({ code: 'custom', message: 'Cached snapshot identity must match the attachment.', path: ['cachedSnapshot', 'machine', 'id'] });
  }
});

const registrySchema = z.object({
  version: z.literal(REGISTRY_VERSION),
  machines: z.array(connectionSchema).max(MAX_MACHINES),
}).strict();

type RegistryRecord = z.infer<typeof registrySchema>;
export type MachineConnection = RegistryRecord['machines'][number];

export class MachineRegistryError extends Error {
  constructor(public readonly code: 'limit' | 'duplicate' | 'unknown' | 'corrupt', message: string) {
    super(message);
    this.name = 'MachineRegistryError';
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => undefined);
  if (!handle) return;
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(targetPath: string, value: unknown): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(json(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class MachineRegistry {
  readonly recordPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly dataDirectory: string) {
    this.recordPath = path.join(dataDirectory, REGISTRY_RECORD);
  }

  async list(): Promise<MachineConnection[]> {
    return structuredClone((await this.readRecord()).machines);
  }

  async get(machineId: string): Promise<MachineConnection> {
    const machine = (await this.readRecord()).machines.find((candidate) => candidate.machine.id === machineId);
    if (!machine) throw new MachineRegistryError('unknown', 'That machine is not attached.');
    return structuredClone(machine);
  }

  async attach(input: {
    machine: MachineIdentity;
    origin: string;
    credential: string;
    expiresAt: string;
    attachedAt?: string;
  }): Promise<void> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      if (record.machines.some((item) => item.machine.id === input.machine.id || item.origin === input.origin)) {
        throw new MachineRegistryError('duplicate', 'That machine or origin is already attached.');
      }
      if (record.machines.length >= MAX_MACHINES) {
        throw new MachineRegistryError('limit', `A home machine can attach at most ${MAX_MACHINES} executors.`);
      }
      const connection: MachineConnection = {
        machine: structuredClone(input.machine),
        origin: input.origin,
        credential: input.credential,
        expiresAt: input.expiresAt,
        attachedAt: input.attachedAt || new Date().toISOString(),
      };
      connectionSchema.parse(connection);
      record.machines.push(connection);
      await this.writeRecord(record);
    });
  }

  async observe(machineId: string, snapshot: ExecutorSnapshot, observedAt = new Date().toISOString()): Promise<void> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const machine = record.machines.find((candidate) => candidate.machine.id === machineId);
      if (!machine) throw new MachineRegistryError('unknown', 'That machine is not attached.');
      const parsed = executorSnapshotSchema.parse(snapshot) as ExecutorSnapshot;
      if (parsed.machine.id !== machine.machine.id) {
        throw new MachineRegistryError('unknown', 'The executor returned a different machine identity.');
      }
      machine.machine.label = parsed.machine.label;
      machine.lastSeenAt = observedAt;
      const changed = JSON.stringify(machine.cachedSnapshot) !== JSON.stringify(parsed);
      const staleObservation = !machine.cachedAt || Date.parse(observedAt) - Date.parse(machine.cachedAt) >= 60_000;
      if (changed || staleObservation) {
        machine.cachedSnapshot = structuredClone(parsed);
        machine.cachedAt = observedAt;
        await this.writeRecord(record);
      }
    });
  }

  async remove(machineId: string): Promise<MachineConnection> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const index = record.machines.findIndex((candidate) => candidate.machine.id === machineId);
      if (index < 0) throw new MachineRegistryError('unknown', 'That machine is not attached.');
      const [removed] = record.machines.splice(index, 1);
      await this.writeRecord(record);
      return structuredClone(removed);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readRecord(): Promise<RegistryRecord> {
    let raw: string;
    try { raw = await readFile(this.recordPath, 'utf8'); } catch (error) {
      if (isMissing(error)) return { version: REGISTRY_VERSION, machines: [] };
      throw error;
    }
    try { return registrySchema.parse(JSON.parse(raw)); } catch {
      throw new MachineRegistryError('corrupt', 'Machine registry is corrupt.');
    }
  }

  private async writeRecord(record: RegistryRecord): Promise<void> {
    registrySchema.parse(record);
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.dataDirectory, 0o700);
    await atomicWrite(this.recordPath, record);
  }
}

const processState = globalThis as typeof globalThis & {
  __codeaiMachineRegistries?: Map<string, MachineRegistry>;
};
const registries = processState.__codeaiMachineRegistries ||= new Map<string, MachineRegistry>();

export function getMachineRegistry(dataDirectory: string): MachineRegistry {
  let registry = registries.get(dataDirectory);
  if (!registry) {
    registry = new MachineRegistry(dataDirectory);
    registries.set(dataDirectory, registry);
  }
  return registry;
}
