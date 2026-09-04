import {
  createHash, randomBytes, randomUUID, timingSafeEqual,
} from 'node:crypto';
import {
  chmod, mkdir, open, readFile, rename, unlink, type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PairedDeviceSummary } from '@/shared/types';

const AUTH_RECORD = 'device-auth-v1.json';
const AUTH_VERSION = 1;
const MAX_DEVICES = 32;
const MAX_PAIRING_ATTEMPTS = 5;
const PAIRING_TTL_MS = 10 * 60 * 1_000;
const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const deviceSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(64),
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
  devices: z.array(deviceSchema).max(MAX_DEVICES),
}).strict();

type AuthRecord = z.infer<typeof authRecordSchema>;
type DeviceRecord = z.infer<typeof deviceSchema>;

export class DeviceAuthError extends Error {
  constructor(public readonly code: 'invalid-code' | 'device-limit' | 'corrupt', message: string) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

export interface DeviceAuthStoreOptions {
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
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

function deviceSummary(device: DeviceRecord, current = false): PairedDeviceSummary {
  return {
    id: device.id,
    label: device.label,
    pairedAt: device.pairedAt,
    expiresAt: device.expiresAt,
    current,
  };
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

export class DeviceAuthStore {
  readonly recordPath: string;
  private readonly now: () => Date;
  private readonly random: (size: number) => Buffer;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(readonly dataDirectory: string, options: DeviceAuthStoreOptions = {}) {
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

  async pair(code: string, label: string): Promise<{
    credential: string;
    device: PairedDeviceSummary;
  }> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const now = this.now();
      record.devices = record.devices.filter((device) => Date.parse(device.expiresAt) > now.getTime());
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
        throw new DeviceAuthError('invalid-code', 'The pairing code is invalid or expired.');
      }
      if (record.devices.length >= MAX_DEVICES) {
        throw new DeviceAuthError('device-limit', `A home machine can pair at most ${MAX_DEVICES} devices.`);
      }
      delete record.pairingChallenge;
      const id = randomUUID();
      const secret = this.random(32).toString('base64url');
      const salt = this.random(16).toString('hex');
      const pairedAt = now.toISOString();
      const device: DeviceRecord = {
        id,
        label: label.trim(),
        salt,
        credentialDigest: digest(salt, secret).toString('hex'),
        pairedAt,
        expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(),
      };
      record.devices.push(device);
      await this.writeRecord(record);
      return { credential: `${id}.${secret}`, device: deviceSummary(device, true) };
    });
  }

  async authenticate(credential: string | undefined): Promise<PairedDeviceSummary | undefined> {
    if (!credential || credential.length > 160) return undefined;
    const separator = credential.indexOf('.');
    if (separator < 1) return undefined;
    const id = credential.slice(0, separator);
    const secret = credential.slice(separator + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
    const record = await this.readRecord();
    const device = record.devices.find((candidate) => candidate.id === id);
    if (!device || Date.parse(device.expiresAt) <= this.now().getTime()) return undefined;
    return equalDigest(device.credentialDigest, digest(device.salt, secret))
      ? deviceSummary(device, true)
      : undefined;
  }

  async list(currentDeviceId: string): Promise<PairedDeviceSummary[]> {
    const record = await this.readRecord();
    const now = this.now().getTime();
    return record.devices
      .filter((device) => Date.parse(device.expiresAt) > now)
      .map((device) => deviceSummary(device, device.id === currentDeviceId))
      .sort((left, right) => right.pairedAt.localeCompare(left.pairedAt));
  }

  async revoke(deviceId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const record = await this.readRecord();
      const next = record.devices.filter((device) => device.id !== deviceId);
      if (next.length === record.devices.length) return false;
      record.devices = next;
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
    try {
      raw = await readFile(this.recordPath, 'utf8');
    } catch (error) {
      if (isMissing(error)) return { version: AUTH_VERSION, devices: [] };
      throw error;
    }
    try {
      return authRecordSchema.parse(JSON.parse(raw));
    } catch {
      throw new DeviceAuthError('corrupt', 'Device authentication record is corrupt.');
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
  __codeaiDeviceAuthStores?: Map<string, DeviceAuthStore>;
};
const stores = processState.__codeaiDeviceAuthStores ||= new Map<string, DeviceAuthStore>();

export function getDeviceAuthStore(dataDirectory: string): DeviceAuthStore {
  let store = stores.get(dataDirectory);
  if (!store) {
    store = new DeviceAuthStore(dataDirectory);
    stores.set(dataDirectory, store);
  }
  return store;
}
