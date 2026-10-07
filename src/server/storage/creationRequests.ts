import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import type { createSessionRequestSchema } from '@/shared/protocol';
import type { DurableProject } from '@/shared/types';
import type { AppConfig } from '@/server/config';
import { getSessionStore, SessionStoreError, sessionStoreErrorCode } from './sessionStore';

export type SessionCreationRequest = z.infer<typeof createSessionRequestSchema>;
const scope = globalThis as typeof globalThis & { __codeAiCreationQueues?: Map<string, Promise<void>> };

/** Both creation branches use one queue; Git materialization must not race ordinary receipt save. */
export async function withSessionCreationLock<T>(dataDir: string, action: () => Promise<T>): Promise<T> {
  const queues = scope.__codeAiCreationQueues ??= new Map();
  const before = queues.get(dataDir) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const tail = before.then(() => held);
  queues.set(dataDir, tail);
  await before;
  try { return await action(); }
  finally { release(); if (queues.get(dataDir) === tail) queues.delete(dataDir); }
}

export function creationFingerprint(request: SessionCreationRequest): string {
  const normalized = {
    provider: request.provider, role: request.role ?? 'coder', execution: request.execution ?? 'local',
    checkoutMode: request.checkoutMode ?? 'current', projectId: request.projectId, checkoutId: request.checkoutId,
    sourceSessionId: request.sourceSessionId, instructions: request.instructions,
    expectedProjectBindings: request.expectedProjectBindings,
    expectedPrimaryCheckoutId: request.expectedPrimaryCheckoutId,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function projectBindingsFingerprint(project: DurableProject): string {
  return createHash('sha256').update(JSON.stringify(project.repositories.map(({ id, hostId, checkoutId, role }) => (
    { id, hostId, checkoutId, role }
  )))).digest('hex');
}

/** Completed requests replay before preflight; unfinished worktree intents stay with their journal. */
export async function replaySessionCreation(request: SessionCreationRequest, config: AppConfig) {
  if (!request.creationRequestId) return undefined;
  const store = getSessionStore(config.dataDir, config.hostLabel);
  const prior = await store.findCreationReceipt(request.creationRequestId);
  if (prior) {
    if (prior.creationReceipt!.fingerprint !== creationFingerprint(request)) {
      throw new SessionStoreError('conflict', 'Creation request id was already used with different choices.');
    }
    return prior;
  }
  const { readWorktreeRecords } = await import('@/server/repository/managedWorktrees');
  const record = (await readWorktreeRecords(config.dataDir)).find((item) => item.request.creationRequestId === request.creationRequestId);
  if (record) {
    if (creationFingerprint(record.request) !== creationFingerprint(request)) {
      throw new SessionStoreError('conflict', 'Creation request id was already used with different choices.');
    }
    if (record.state === 'ready') {
      try { return await store.getSession(record.session.id); }
      catch (error) {
        if (sessionStoreErrorCode(error) !== 'unknown') throw error;
        return store.getArchivedSession(record.session.id);
      }
    }
  } else if (await lstat(path.join(config.dataDir, 'worktrees', `${request.creationRequestId}.json`)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  })) {
    throw new SessionStoreError('conflict', 'The retained creation journal requires inspection. Retry cannot replace it.');
  }
  return undefined;
}

/** Failure classification never discards a durable intent or a request still being serialized. */
export async function sessionCreationFailure(requestId: string | undefined, config: AppConfig) {
  if (!requestId) return { creationState: 'none' as const };
  try {
    const saved = await getSessionStore(config.dataDir, config.hostLabel).findCreationReceipt(requestId);
    if (saved) return { creationState: 'retained' as const, sessionId: saved.id };
    if (await lstat(path.join(config.dataDir, 'worktrees', `${requestId}.json`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    })) return { creationState: 'retained' as const };
    return { creationState: scope.__codeAiCreationQueues?.has(config.dataDir) ? 'unknown' as const : 'none' as const };
  } catch { return { creationState: 'unknown' as const }; }
}
