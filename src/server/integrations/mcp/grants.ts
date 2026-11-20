import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@/server/config';
import { atomicWrite } from '@/server/storage/atomicWrite';
import { getSessionStore, readStoredMachineIdentity } from '@/server/storage/sessionStore';
import { requestHasSecureTransport } from '@/server/devices/deviceAuthorization';
import { mcpScopeSchema, type McpConnection, type McpScope } from '@/shared/mcp';

const grantSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(64),
  machineId: z.string().uuid(), origin: z.string().url(), digest: z.string().regex(/^[0-9a-f]{64}$/),
  scopes: z.array(mcpScopeSchema), createdAt: z.string().datetime() }).strict();
export type McpGrant = z.infer<typeof grantSchema>;
export class McpError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly retryable = false) { super(message); }
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const directory = (config: AppConfig) => path.join(config.dataDir, 'integrations', 'mcp');
export function integrationOrigin(config: AppConfig): string {
  const origin = config.remoteAccess === 'paired' ? config.publicOrigin : process.env.CODEAI_MCP_ORIGIN || process.env.CODEAI_WEB2_MCP_ORIGIN || 'http://127.0.0.1:3023';
  if (!origin) throw new McpError('setup', 'Configure the CodeAI server origin before provisioning MCP.');
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (config.remoteAccess === 'paired'
    ? url.protocol !== 'https:' : url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) {
    throw new McpError('setup', 'MCP requires the configured HTTPS origin or an exact local HTTP loopback origin.');
  }
  return origin;
}
export async function provisionGrant(config: AppConfig, name: string, scopes: McpScope[] = []) {
  // Connection credentials must never be written into a checkout.
  const dataRoot = await realpath(config.dataDir);
  const roots = await Promise.all([config.repositoriesRoot, config.worktreesRoot].filter(Boolean).map(async root => realpath(root).catch(() => path.resolve(root))));
  const assertOutside = (target: string) => {
    if (roots.some(root => { const relative = path.relative(root, target);
      return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); })) {
      throw new McpError('setup', 'Move CODEAI_DATA_DIR and its integration directory outside repository and worktree roots before provisioning MCP.');
    }
  };
  assertOutside(dataRoot);
  const root = directory(config);
  await mkdir(root, { recursive: true, mode: 0o700 });
  assertOutside(await realpath(root)); await chmod(root, 0o700);
  const credential = randomBytes(32).toString('base64url');
  const machine = await readStoredMachineIdentity(config.dataDir);
  if (!machine) throw new McpError('setup', 'Start CodeAI once before provisioning an MCP connection.');
  const grant = grantSchema.parse({ id: randomUUID(), name, scopes: [...new Set<McpScope>(['projects:read', 'sessions:read', ...scopes])],
    origin: integrationOrigin(config), machineId: machine.id,
    digest: digest(credential), createdAt: new Date().toISOString() });
  await atomicWrite(path.join(root, `${grant.id}.grant.json`), grant);
  const connection: McpConnection = { version: 1, grantId: grant.id, machineId: grant.machineId, origin: grant.origin, credential };
  const connectionPath = path.join(root, `${grant.id}.connection.json`);
  await atomicWrite(connectionPath, connection);
  return { grant, connectionPath };
}
export async function listGrants(config: AppConfig): Promise<McpGrant[]> {
  const names = await readdir(directory(config)).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  return Promise.all(names.filter(n => /^[0-9a-f-]{36}\.grant\.json$/i.test(n)).map(n => readFile(path.join(directory(config), n), 'utf8').then(v => grantSchema.parse(JSON.parse(v)))));
}
export async function revokeGrant(config: AppConfig, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new McpError('invalid', 'A grant UUID is required.');
  await unlink(path.join(directory(config), `${id}.grant.json`));
  await unlink(path.join(directory(config), `${id}.connection.json`)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
}
export async function grantExists(config: AppConfig, id: string): Promise<boolean> {
  try { grantSchema.parse(JSON.parse(await readFile(path.join(directory(config), `${id}.grant.json`), 'utf8'))); return true; }
  catch { return false; }
}
export async function authorizeIntegration(request: Request, config: AppConfig, scope?: McpScope): Promise<McpGrant> {
  const id = request.headers.get('x-codeai-grant-id');
  const bearer = request.headers.get('authorization');
  if (!id || !z.string().uuid().safeParse(id).success || !bearer?.match(/^CodeAI-MCP [a-zA-Z0-9_-]{43}$/)) {
    throw new McpError('unauthorized', 'A CodeAI MCP integration grant is required.', 401);
  }
  let grant: McpGrant;
  try { grant = grantSchema.parse(JSON.parse(await readFile(path.join(directory(config), `${id}.grant.json`), 'utf8'))); }
  catch { throw new McpError('unauthorized', 'MCP grant is missing or revoked. Provision a new connection.', 401); }
  const expected = Buffer.from(grant.digest); const actual = Buffer.from(digest(bearer.slice(11)));
  if (!timingSafeEqual(expected, actual)) throw new McpError('unauthorized', 'Invalid MCP credential.', 401);
  const origin = integrationOrigin(config);
  if (grant.origin !== origin || request.headers.get('host') !== new URL(origin).host || request.headers.get('origin') !== origin
    || !requestHasSecureTransport(request, config)) throw new McpError('transport', 'Use the exact configured CodeAI origin and trusted transport.', 403);
  const machineId = (await getSessionStore(config.dataDir, config.hostLabel).host()).id;
  if (grant.machineId !== machineId || request.headers.get('x-codeai-machine-id') !== machineId) throw new McpError('identity', 'CodeAI machine identity changed. Provision a new connection.', 409);
  if (scope && !grant.scopes.includes(scope)) throw new McpError('forbidden', `MCP grant requires ${scope}.`, 403);
  return grant;
}
