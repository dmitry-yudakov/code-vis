import {
  createHash, randomBytes, randomUUID, timingSafeEqual,
} from 'node:crypto';
import {
  chmod, mkdir, open, readFile, rename, unlink, type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AttachedMachineSummary, MachineIdentity } from '@/shared/types';

const AUTH_RECORD = 'machine-auth-v1.json';
const AUTH_VERSION = 1;
const MAX_PEERS = 8;
const MAX_PAIRING_ATTEMPTS = 5;
const PAIRING_TTL_MS = 10 * 60 * 1_000;
const CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const peerSchema = z.object({
  connectionId: z.string().uuid(),
  machineId: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  credentialDigest: digestSchema,
  pairedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
const authRecordSchema = z.object({
  version: z.literal(AUTH_VERSION),
  pairingChallenge: z.object({
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    codeDigest: digestSchema,
    expiresAt: z.string().datetime(),
    failedAttempts: z.number().int().min(0).max(MAX_PAIRING_ATTEMPTS - 1),
  }).strict().optional(),
  peers: z.array(peerSchema).max(MAX_PEERS),
}).strict();

type AuthRecord = z.infer<typeof authRecordSchema>;
type PeerRecord = z.infer<typeof peerSchema>;

export interface AuthenticatedMachine extends AttachedMachineSummary {
  connectionId: string;
}

export interface MachineAuthStoreOptions {
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

export class MachineAuthError extends Error {
  constructor(
    public readonly code: 'invalid-code' | 'peer-limit' | 'duplicate-peer' | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'MachineAuthError';
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function digest(salt: string, secret: string): Buffer {
  return createHash('sha256').update(salt, 'utf8').update('\0').update(secret, 'utf8').digest();
}

function equalDigest(expectedHex: string, actual: Buffer): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeCode(code: string): string | undefined {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{16}$/.test(normalized) ? normalized : undefined;
}

function displayCode(code: string): string {
  return code.match(/.{1,4}/g)!.join('-');
}

function publicPeer(peer: PeerRecord): AuthenticatedMachine {
  return {
    connectionId: peer.connectionId,
    id: peer.machineId,
    label: peer.label,
    pairedAt: peer.pairedAt,
    expiresAt: peer.expiresAt,
  };
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

export class MachineAuthStore {
  readonly recordPath: string;
  private readonly now: () => Date;
  private readonly random: (size: number) => Buffer;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly dataDirectory: string, options: MachineAuthStoreOptions = {}) {
    this.recordPath = path.join(dataDirectory, AUTH_RECORD);
    this.now = options.now || (() => new Date());
    this.random = options.randomBytes || randomBytes;
  }

  async issuePairingCode(): Promise<{ code: string; expiresAt: string }> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const normalized = Array.from(this.random(16), (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length])
        .join('');
      const salt = this.random(16).toString('hex');
      const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS).toISOString();
      record.pairingChallenge = {
        salt,
        codeDigest: digest(salt, normalized).toString('hex'),
        expiresAt,
        failedAttempts: 0,
      };
      await this.writeRecord(record);
      return { code: displayCode(normalized), expiresAt };
    });
  }

  async pair(code: string, machine: MachineIdentity): Promise<{
    credential: string;
    peer: AuthenticatedMachine;
  }> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const now = this.now();
      record.peers = record.peers.filter((peer) => Date.parse(peer.expiresAt) > now.getTime());
      const challenge = record.pairingChallenge;
      const normalized = normalizeCode(code);
      const valid = Boolean(
        challenge
        && Date.parse(challenge.expiresAt) > now.getTime()
        && normalized
        && equalDigest(challenge.codeDigest, digest(challenge.salt, normalized)),
      );
      if (!valid) {
        if (challenge && Date.parse(challenge.expiresAt) > now.getTime()) {
          challenge.failedAttempts += 1;
          if (challenge.failedAttempts >= MAX_PAIRING_ATTEMPTS) delete record.pairingChallenge;
        } else {
          delete record.pairingChallenge;
        }
        await this.writeRecord(record);
        throw new MachineAuthError('invalid-code', 'The machine pairing code is invalid or expired.');
      }
      if (record.peers.some((peer) => peer.machineId === machine.id)) {
        delete record.pairingChallenge;
        await this.writeRecord(record);
        throw new MachineAuthError('duplicate-peer', 'That machine is already attached. Detach it before pairing again.');
      }
      if (record.peers.length >= MAX_PEERS) {
        delete record.pairingChallenge;
        await this.writeRecord(record);
        throw new MachineAuthError('peer-limit', `An executor can accept at most ${MAX_PEERS} attached machines.`);
      }
      delete record.pairingChallenge;
      const connectionId = randomUUID();
      const secret = this.random(32).toString('base64url');
      const salt = this.random(16).toString('hex');
      const pairedAt = now.toISOString();
      const peer: PeerRecord = {
        connectionId,
        machineId: machine.id,
        label: machine.label,
        salt,
        credentialDigest: digest(salt, secret).toString('hex'),
        pairedAt,
        expiresAt: new Date(now.getTime() + CREDENTIAL_TTL_MS).toISOString(),
      };
      record.peers.push(peer);
      await this.writeRecord(record);
      return { credential: `${connectionId}.${secret}`, peer: publicPeer(peer) };
    });
  }

  async authenticate(credential: string | undefined): Promise<AuthenticatedMachine | undefined> {
    if (!credential || credential.length > 180) return undefined;
    const separator = credential.indexOf('.');
    if (separator < 1) return undefined;
    const connectionId = credential.slice(0, separator);
    const secret = credential.slice(separator + 1);
    if (!/^[0-9a-f-]{36}$/i.test(connectionId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
    const record = await this.readRecord();
    const peer = record.peers.find((candidate) => candidate.connectionId === connectionId);
    if (!peer || Date.parse(peer.expiresAt) <= this.now().getTime()) return undefined;
    return equalDigest(peer.credentialDigest, digest(peer.salt, secret)) ? publicPeer(peer) : undefined;
  }

  async listPeers(): Promise<AuthenticatedMachine[]> {
    const now = this.now().getTime();
    return (await this.readRecord()).peers
      .filter((peer) => Date.parse(peer.expiresAt) > now)
      .map(publicPeer);
  }

  async revoke(connectionId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const peers = record.peers.filter((peer) => peer.connectionId !== connectionId);
      if (peers.length === record.peers.length) return false;
      record.peers = peers;
      await this.writeRecord(record);
      return true;
    });
  }

  async revokeMachine(machineId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const peers = record.peers.filter((peer) => peer.machineId !== machineId);
      if (peers.length === record.peers.length) return false;
      record.peers = peers;
      await this.writeRecord(record);
      return true;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readRecord(): Promise<AuthRecord> {
    let raw: string;
    try { raw = await readFile(this.recordPath, 'utf8'); } catch (error) {
      if (isMissing(error)) return { version: AUTH_VERSION, peers: [] };
      throw error;
    }
    try { return authRecordSchema.parse(JSON.parse(raw)); } catch {
      throw new MachineAuthError('corrupt', 'Machine authentication record is corrupt.');
    }
  }

  private async writeRecord(record: AuthRecord): Promise<void> {
    authRecordSchema.parse(record);
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.dataDirectory, 0o700);
    await atomicWrite(this.recordPath, record);
  }
}

const processState = globalThis as typeof globalThis & {
  __codeaiMachineAuthStores?: Map<string, MachineAuthStore>;
};
const stores = processState.__codeaiMachineAuthStores ||= new Map<string, MachineAuthStore>();

export function getMachineAuthStore(dataDirectory: string): MachineAuthStore {
  let store = stores.get(dataDirectory);
  if (!store) {
    store = new MachineAuthStore(dataDirectory);
    stores.set(dataDirectory, store);
  }
  return store;
}
