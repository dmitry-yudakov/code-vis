import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { agentMessageRequestSchema } from '@/shared/protocol';
import { atomicWrite, syncDirectory } from '@/server/storage/atomicWrite';

const progressSchema = z.object({
  attempt: z.number().int().nonnegative(), spentMs: z.number().nonnegative(),
  usedTurns: z.number().int().nonnegative(), continuation: z.boolean(),
}).strict();
const suspendedTurnSchema = z.object({
  version: z.literal(1), runId: z.string().uuid(), hostId: z.string().uuid(),
  checkoutPath: z.string().min(1), execution: z.enum(['local', 'docker']),
  providerSessionId: z.string().min(1).optional(), checkpointId: z.string().optional(),
  state: z.enum(['preparing', 'ready', 'resuming']), acceptedAt: z.string().datetime(),
  request: agentMessageRequestSchema, progress: progressSchema,
}).strict();
export type SuspendedTurn = z.infer<typeof suspendedTurnSchema>;

/** Private restart journal, outside temporary attachments and replaceable build directories. */
export class SuspendedTurns {
  readonly directory: string;
  constructor(dataDir: string) { this.directory = path.join(dataDir, 'suspended-turns'); }

  async save(turn: SuspendedTurn): Promise<void> {
    const checked = suspendedTurnSchema.parse(turn);
    if (Buffer.byteLength(`${JSON.stringify(checked)}\n`) > 6_100_000) throw new Error('Suspended request exceeds its storage limit.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicWrite(this.file(checked.runId), checked, undefined, true);
  }

  async list(): Promise<SuspendedTurn[]> {
    const names = await readdir(this.directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const files = names.filter(name => name.endsWith('.json'));
    if (files.length > 1_000) throw new Error('Too many suspended turn records.');
    const turns: SuspendedTurn[] = [];
    for (const name of files) {
      const runId = name.slice(0, -5);
      const turn = await this.get(runId);
      if (turn) turns.push(turn);
    }
    return turns.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
  }

  async get(runId: string): Promise<SuspendedTurn | undefined> {
    const bytes = await readFile(this.file(runId)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!bytes) return undefined;
    if (bytes.length > 6_100_000) throw new Error('Suspended request exceeds its storage limit.');
    const turn = suspendedTurnSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (turn.runId !== runId) throw new Error('Suspended turn identity does not match its record.');
    return turn;
  }

  async remove(runId: string): Promise<void> {
    await unlink(this.file(runId)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await syncDirectory(this.directory);
  }

  private file(runId: string): string {
    return path.join(this.directory, `${z.string().uuid().parse(runId)}.json`);
  }
}
