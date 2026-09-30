import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  checkout: '',
  dockerAvailable: true,
  /** Runs once a path has been resolved and before it is opened: the moment a turn would swap it. */
  beforeRead: undefined as (() => Promise<void>) | undefined,
  /** Answers the next reads in place of the reader, one each. */
  readAnswers: [] as Array<{ issue: 'changed' }>,
  /** Whether each read asked for proof that its handle is the resolved file. */
  proofs: [] as boolean[],
  runs: [] as Array<{ provider: string; globalInstructions?: { displayPath: string; text: string }; userCustomizations?: boolean }>,
}));

vi.mock('@/server/boundedTextFile', async (original) => {
  const actual = await original<typeof import('@/server/boundedTextFile')>();
  return {
    ...actual,
    readBoundedTextFile: async (...input: Parameters<typeof actual.readBoundedTextFile>) => {
      await routeState.beforeRead?.();
      routeState.proofs.push(Boolean(input[2]?.exactly));
      return routeState.readAnswers.shift() ?? actual.readBoundedTextFile(...input);
    },
  };
});

vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({
    list: async () => [],
    resolve: async (id: string) => ({ id, name: 'Repository', relativePath: 'repository', realPath: routeState.checkout }),
  }),
}));

vi.mock('@/server/execution/dockerRuntime', async (original) => ({
  ...await original<typeof import('@/server/execution/dockerRuntime')>(),
  getDockerRuntime: () => ({
    health: async () => (routeState.dockerAvailable
      ? { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] }
      : { available: false, authenticated: 'unknown', supportedModes: [], message: 'Docker execution is disabled on this machine.' }),
    reconcile: async () => [],
  }),
}));

vi.mock('@/server/execution/dockerProfile', async (original) => ({
  ...await original<typeof import('@/server/execution/dockerProfile')>(),
  validateDockerCheckout: async () => ({ uid: 1000, gid: 1000 }),
}));

vi.mock('@/server/agents/providerRegistry', async (original) => {
  const adapter = (provider: string) => ({
    checkHealth: async () => ({ available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] }),
    // Records what the turn was given, then completes it.
    createRunner: () => ({
      run: async (input: { globalInstructions?: { displayPath: string; text: string }; userCustomizations?: boolean }) => {
        routeState.runs.push({ provider, globalInstructions: input.globalInstructions, userCustomizations: input.userCustomizations });
        return { finalText: 'Done.', sessionId: 'provider-session', durationMs: 1, outputBytes: 5 };
      },
    }),
  });
  return {
    ...await original<typeof import('@/server/agents/providerRegistry')>(),
    getProviderAdapters: () => ({ claude: adapter('claude'), codex: adapter('codex') }),
  };
});

import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { GET as GET_HEALTH } from '@/app/api/health/route';
import { GET as GET_INSTRUCTIONS, PATCH as PATCH_INSTRUCTIONS } from '@/app/api/instructions/route';
import { POST as POST_PARTICIPANT } from '@/app/api/sessions/[sessionId]/participants/route';
import { POST as POST_SESSION } from '@/app/api/sessions/route';
import { ClaudeProcessRunner } from '@/server/agents/claudeProcessRunner';
import { buildClaudeArgs, requiredFlagsForMode } from '@/server/agents/claudeInvocation';
import { codexDeveloperInstructions } from '@/server/agents/codexInvocation';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import {
  frameGlobalInstructions, hasInstructionImports, instructionSettingsPath, readInstructionSettings,
  resolveGlobalInstructionFile as resolveFile, turnGlobalInstructions as resolveTurn,
} from '@/server/agents/globalInstructions';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { readBoundedTextFile } from '@/server/boundedTextFile';
import { getConfig } from '@/server/config';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore, publicSession, type SessionStore } from '@/server/storage/sessionStore';
import {
  GLOBAL_INSTRUCTIONS_BYTES, LOCAL_CODEX_ISOLATION_MESSAGE, effectiveInstructions, instructionsLine,
} from '@/shared/globalInstructions';
import { createSessionRequestSchema } from '@/shared/protocol';
import { userOwnedParent } from './userOwned';
import { INSTRUCTIONS_SESSION_VERSION, MAX_READABLE_SESSION_VERSION, durableSessionSchema } from '@/shared/sessionSchema';
import type {
  AgentProvider, DurableSession, GlobalInstructionsChoice, GlobalInstructionsView, MachineInstructions,
} from '@/shared/types';

const FAKE_CLAUDE = path.resolve('test/fixtures/fake-claude.mjs');
const FAKE_CODEX = path.resolve('test/fixtures/fake-codex.mjs');
const MARKER = 'Always answer with the word PINEAPPLE.';
const directories: string[] = [];
let home: string;
let dataDir: string;
let repositories: string;

const resolveGlobalInstructionFile = (provider: AgentProvider) => resolveFile(provider, { repositoriesRoot: repositories });
const turnGlobalInstructions = (turn: { dataDir: string } & Parameters<typeof resolveTurn>[1]) => (
  resolveTurn({ dataDir: turn.dataDir, repositoriesRoot: repositories }, turn)
);

async function scratch(prefix: string, parent = os.tmpdir()): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(parent, prefix)));
  directories.push(directory);
  return directory;
}

// The temp directory is a place an agent turn can write, so nothing there is the user's own.
const USER_OWNED = userOwnedParent();

async function write(file: string, contents: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

const claudeFile = () => path.join(home, '.claude', 'CLAUDE.md');
const codexFile = (name = 'AGENTS.md') => path.join(home, '.codex', name);
const FRAME_HEAD = (displayPath: string) => `The user's global instructions from \`${displayPath}\` follow. Where they conflict with CodeAI's instructions, CodeAI's instructions apply.`;

beforeEach(async () => {
  home = await scratch('codeai-instructions-home-', USER_OWNED);
  dataDir = await scratch('codeai-instructions-data-');
  repositories = await scratch('codeai-instructions-repositories-');
  routeState.checkout = path.join(repositories, 'checkout');
  await mkdir(routeState.checkout);
  routeState.runs = [];
  routeState.dockerAvailable = true;
  routeState.beforeRead = undefined;
  routeState.readAnswers = [];
  routeState.proofs = [];
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', repositories);
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
  vi.stubEnv('CODEX_HOME', '');
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  vi.stubEnv('CODEAI_HOST_LABEL', 'Home');
  vi.stubEnv('CODEAI_DOCKER_ENABLED', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the provider\'s own global instruction file', () => {
  it('reads ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md, or the folder each provider\'s variable names', async () => {
    await write(claudeFile(), 'claude home\n');
    await write(codexFile(), 'codex home\n');
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', realPath: claudeFile(), text: 'claude home\n' });
    expect(await resolveGlobalInstructionFile('codex')).toEqual({ displayPath: '~/.codex/AGENTS.md', name: 'AGENTS.md', realPath: codexFile(), text: 'codex home\n' });

    const elsewhere = await scratch('codeai-instructions-config-');
    await write(path.join(elsewhere, 'CLAUDE.md'), 'configured claude\n');
    await write(path.join(elsewhere, 'AGENTS.md'), 'configured codex\n');
    vi.stubEnv('CLAUDE_CONFIG_DIR', elsewhere);
    vi.stubEnv('CODEX_HOME', elsewhere);
    // Outside the home directory the path is shown whole.
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ displayPath: path.join(elsewhere, 'CLAUDE.md'), text: 'configured claude\n' });
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: path.join(elsewhere, 'AGENTS.md'), text: 'configured codex\n' });

    // A relative value would name a folder under the turn's checkout: never read as the user's own.
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'relative/claude');
    vi.stubEnv('CODEX_HOME', 'relative/codex');
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ displayPath: '~/.claude/CLAUDE.md', text: 'claude home\n' });
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: '~/.codex/AGENTS.md', text: 'codex home\n' });
  });

  it('prefers AGENTS.override.md as Codex does: when it holds text, and never for Claude', async () => {
    await write(codexFile(), 'plain\n');
    await write(codexFile('AGENTS.override.md'), 'override\n');
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: '~/.codex/AGENTS.override.md', text: 'override\n' });
    // Codex skips an override without text, and one it cannot read as a file.
    await write(codexFile('AGENTS.override.md'), ' \n\n');
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: '~/.codex/AGENTS.md', text: 'plain\n' });
    await rm(codexFile('AGENTS.override.md'));
    await mkdir(codexFile('AGENTS.override.md'));
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: '~/.codex/AGENTS.md', text: 'plain\n' });
    // An override CodeAI cannot pass stays the answer: AGENTS.md is never passed in its place.
    await rm(codexFile('AGENTS.override.md'), { recursive: true });
    await write(codexFile('AGENTS.override.md'), 'x'.repeat(GLOBAL_INSTRUCTIONS_BYTES + 1));
    expect(await resolveGlobalInstructionFile('codex')).toEqual({
      displayPath: '~/.codex/AGENTS.override.md', name: 'AGENTS.override.md', realPath: codexFile('AGENTS.override.md'), issue: 'too-large',
    });

    await write(path.join(home, '.claude', 'AGENTS.override.md'), 'not claude\'s\n');
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'missing' });
  });

  it('follows a symbolic link and shows where it leads', async () => {
    await write(codexFile(), `${MARKER}\n`);
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink(codexFile(), claudeFile());
    expect(await resolveGlobalInstructionFile('claude')).toEqual({
      displayPath: '~/.claude/CLAUDE.md → ~/.codex/AGENTS.md', name: 'CLAUDE.md', realPath: codexFile(), text: `${MARKER}\n`,
    });
    // A link to nothing is a missing file.
    await rm(codexFile());
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'missing' });
  });

  it('passes a file whole or not at all: missing, too large, not text, and not a regular file are issues', async () => {
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'missing' });
    const issue = async (contents: string | Buffer) => {
      await write(claudeFile(), contents);
      const file = await resolveGlobalInstructionFile('claude');
      // Whatever the reason, no part of the file is ever returned.
      expect(file).not.toHaveProperty('text');
      return 'issue' in file ? file.issue : undefined;
    };
    const limit = 'é'.repeat(GLOBAL_INSTRUCTIONS_BYTES / 2);
    await write(claudeFile(), limit);
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: limit });
    expect(await issue(`${limit}!`)).toBe('too-large');
    expect(await issue(Buffer.from([0x68, 0x69, 0xff, 0xfe]))).toBe('not-text');
    expect(await issue('before\0after')).toBe('not-text');
    await rm(claudeFile());
    await mkdir(claudeFile());
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', realPath: claudeFile(), issue: 'not-file' });
    for (const provider of ['claude', 'codex'] as const) {
      expect((await turnGlobalInstructions({ dataDir, provider, execution: 'docker' })).globalInstructions).toBeUndefined();
    }
  });

  it('recognises @ imports outside code, which are passed as written', () => {
    expect(hasInstructionImports('Follow @~/.claude/style.md and\n@docs/git.md')).toBe(true);
    expect(hasInstructionImports('Mail me at someone@example.com.\nNo imports here.')).toBe(false);
    // Claude reads no import inside a code span or a fenced block.
    expect(hasInstructionImports('Install `@anthropic-ai/sdk`.\n\n```py\n@dataclass\nclass A: ...\n```\n')).toBe(false);
    expect(hasInstructionImports('```ts\n// @ts-expect-error\n```\nThen read @docs/style.md.')).toBe(true);
  });

  it('names the override that is there when neither file can be used', async () => {
    await mkdir(codexFile('AGENTS.override.md'), { recursive: true });
    expect(await resolveGlobalInstructionFile('codex')).toEqual({
      displayPath: '~/.codex/AGENTS.override.md', name: 'AGENTS.override.md', realPath: codexFile('AGENTS.override.md'), issue: 'not-file',
    });
  });

  it.skipIf(process.getuid?.() === 0)('skips an override it has no permission to read, as Codex does', async () => {
    await write(codexFile(), 'plain\n');
    await write(codexFile('AGENTS.override.md'), 'override\n');
    await chmod(codexFile('AGENTS.override.md'), 0o000);
    expect(await resolveGlobalInstructionFile('codex')).toMatchObject({ displayPath: '~/.codex/AGENTS.md', text: 'plain\n' });
  });

  it('shows paths from the home directory when that is itself reached through a link', async () => {
    const linkedHome = path.join(await scratch('codeai-instructions-link-', USER_OWNED), 'home');
    await symlink(home, linkedHome);
    vi.stubEnv('HOME', linkedHome);
    await write(path.join(home, 'dotfiles', 'CLAUDE.md'), 'Dotfiles.\n');
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink(path.join(home, 'dotfiles', 'CLAUDE.md'), claudeFile());
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ displayPath: '~/.claude/CLAUDE.md → ~/dotfiles/CLAUDE.md', text: 'Dotfiles.\n' });
  });

  it('finds nothing beyond a regular file, as the kernel does', async () => {
    await write(path.join(home, 'notes', 'a.md'), 'A\n');
    await write(path.join(home, 'notes', 'b.md'), 'B\n');
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    for (const target of ['../notes/a.md/', '../notes/a.md/.', '../notes/a.md/../b.md']) {
      await rm(claudeFile(), { force: true });
      await symlink(target, claudeFile());
      await expect(readFile(claudeFile(), 'utf8'), target).rejects.toMatchObject({ code: 'ENOTDIR' });
      expect(await resolveGlobalInstructionFile('claude'), target).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'missing' });
    }
  });

  it('never reads a private file of a provider folder, whatever links to it', async () => {
    await write(codexFile('auth.json'), '{"token":"SYNTHETIC_CREDENTIAL"}');
    await symlink(codexFile('auth.json'), codexFile());
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink(codexFile('auth.json'), claudeFile());
    for (const [provider, displayPath] of [['codex', '~/.codex/AGENTS.md'], ['claude', '~/.claude/CLAUDE.md']] as const) {
      expect(await resolveGlobalInstructionFile(provider)).toEqual({ displayPath, name: path.basename(displayPath), issue: 'protected' });
      expect(JSON.stringify(await turnGlobalInstructions({ dataDir, provider, execution: 'docker' }))).not.toContain('SYNTHETIC');
    }
    // An allowlisted entry of the other provider is the ordinary shared file.
    await rm(codexFile());
    await write(codexFile(), 'shared\n');
    await rm(claudeFile());
    await symlink(codexFile(), claudeFile());
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'shared\n' });
  });

  it('keeps the home folder of a provider private when a variable names another folder', async () => {
    const configured = await scratch('codeai-instructions-configured-', USER_OWNED);
    vi.stubEnv('CLAUDE_CONFIG_DIR', configured);
    await write(path.join(home, '.claude', '.credentials.json'), '{"token":"SYNTHETIC_CREDENTIAL"}');
    await symlink(path.join(home, '.claude', '.credentials.json'), path.join(configured, 'CLAUDE.md'));
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'protected' });
  });

  it('lets the innermost provider folder decide what is private when one is nested in the other', async () => {
    const nested = path.join(home, '.codex', 'skills', 'claude');
    vi.stubEnv('CLAUDE_CONFIG_DIR', nested);
    await write(path.join(nested, '.credentials.json'), '{"token":"SYNTHETIC_CREDENTIAL"}');
    await symlink(path.join(nested, '.credentials.json'), codexFile());
    // Inside Codex's allowlisted skills/, but a private file of the Claude folder that lives there.
    expect(await resolveGlobalInstructionFile('codex')).toEqual({ displayPath: '~/.codex/AGENTS.md', name: 'AGENTS.md', issue: 'protected' });
    await write(path.join(nested, 'CLAUDE.md'), 'nested\n');
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'nested\n' });
  });

  it('gives up on links that lead in a circle', async () => {
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink(path.join(home, '.claude', 'skills'), claudeFile());
    await symlink(claudeFile(), path.join(home, '.claude', 'skills'));
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'unreadable' });
  });

  it('resolves .. in a link as the kernel does, so it reads the file the provider reads', async () => {
    // ~/.claude/CLAUDE.md -> ../jump/../CLAUDE.md, where jump is a link: .. leaves the folder jump leads to.
    await write(path.join(home, 'CLAUDE.md'), 'LEXICAL TARGET\n');
    await write(path.join(home, 'far', 'CLAUDE.md'), 'KERNEL TARGET\n');
    await mkdir(path.join(home, 'far', 'inside'));
    await symlink(path.join(home, 'far', 'inside'), path.join(home, 'jump'));
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink('../jump/../CLAUDE.md', claudeFile());
    expect(await readFile(claudeFile(), 'utf8')).toBe('KERNEL TARGET\n');
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ displayPath: '~/.claude/CLAUDE.md → ~/far/CLAUDE.md', text: 'KERNEL TARGET\n' });
  });
});

describe('the whole-or-nothing reader', () => {
  it.skipIf(process.platform !== 'linux')('never reads more than one byte past the limit, whatever the file claims its size is', async () => {
    // A /proc file is a regular file of size 0 that holds megabytes.
    const probe = await open('/proc/kallsyms', 'r');
    const read = vi.spyOn(Object.getPrototypeOf(probe), 'read');
    await probe.close();
    expect(await readBoundedTextFile('/proc/kallsyms', 4_096)).toEqual({ issue: 'too-large' });
    const asked = read.mock.calls.reduce((total, [, , length]) => total + Number(length), 0);
    expect(read).toHaveBeenCalled();
    expect(asked).toBeLessThanOrEqual(4_097 * 2);
  });

  it.skipIf(process.platform !== 'linux')('with exactly, opens only the file at that very path', async () => {
    const real = path.join(home, 'real');
    await write(path.join(real, 'notes.md'), 'notes\n');
    await write(path.join(home, 'secret', 'notes.md'), 'SYNTHETIC_PRIVATE_KEY\n');
    expect(await readBoundedTextFile(path.join(real, 'notes.md'), 4_096, { exactly: true })).toEqual({ text: 'notes\n' });
    // The file itself swapped for a link, then a folder on the way: what a walk approved is no longer what opens.
    await symlink(path.join(home, 'secret', 'notes.md'), path.join(real, 'link.md'));
    expect(await readBoundedTextFile(path.join(real, 'link.md'), 4_096, { exactly: true })).toEqual({ issue: 'changed' });
    await symlink(path.join(home, 'secret'), path.join(home, 'swapped'));
    expect(await readBoundedTextFile(path.join(home, 'swapped', 'notes.md'), 4_096, { exactly: true })).toEqual({ issue: 'changed' });
    // Without it, as for the personal Git ignore file, links are followed.
    expect(await readBoundedTextFile(path.join(home, 'swapped', 'notes.md'), 4_096)).toEqual({ text: 'SYNTHETIC_PRIVATE_KEY\n' });
  });

  it('opens a FIFO without waiting for a writer, and reads none of it', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [path.join(home, 'pipe')]);
    expect(await readBoundedTextFile(path.join(home, 'pipe'), 4_096)).toEqual({ issue: 'not-file' });
  });
});

describe('a link an agent turn could repoint', () => {
  // The home is outside the temp directory, so that only the repositories root decides what a turn can write.
  let outside: string;
  beforeEach(async () => {
    outside = home;
    // The repositories root too: a checkout is a place a turn can write wherever it is.
    repositories = path.join(outside, 'repositories');
    routeState.checkout = path.join(repositories, 'checkout');
    await mkdir(routeState.checkout, { recursive: true });
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', repositories);
    await mkdir(path.join(outside, '.claude'), { recursive: true });
    await write(path.join(outside, 'secret.txt'), 'SYNTHETIC_PRIVATE_KEY\n');
  });
  const link = () => path.join(outside, '.claude', 'CLAUDE.md');

  it('follows the user\'s own links, into a checkout too, while the file there is a real file', async () => {
    await write(path.join(outside, 'dotfiles', 'real.md'), 'Dotfiles.\n');
    await symlink(path.join(outside, 'dotfiles', 'real.md'), path.join(outside, 'dotfiles', 'CLAUDE.md'));
    await symlink(path.join(outside, 'dotfiles', 'CLAUDE.md'), link());
    // Two links, neither of them where a turn can write.
    expect(await resolveGlobalInstructionFile('claude')).toEqual({
      displayPath: '~/.claude/CLAUDE.md → ~/dotfiles/real.md', name: 'CLAUDE.md', realPath: path.join(outside, 'dotfiles', 'real.md'), text: 'Dotfiles.\n',
    });
    await rm(link());
    await write(path.join(routeState.checkout, 'AGENTS.md'), 'Kept in a repository.\n');
    await symlink(path.join(routeState.checkout, 'AGENTS.md'), link());
    // It is passed, and marked as a file a turn there can rewrite.
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Kept in a repository.\n', agentEditable: true });
    const view = await (await GET_INSTRUCTIONS(new Request('http://localhost:3023/api/instructions'))).json() as GlobalInstructionsView;
    expect(view.providers.claude).toMatchObject({ agentEditable: true, docker: { entries: [], skipped: ['CLAUDE.md is under the repositories root or a temp directory, where an agent turn can change it'] } });
    expect(view.providers.codex).not.toHaveProperty('agentEditable');
  });

  it('does not read such a file at all where the system cannot prove which file it opened', async () => {
    await write(path.join(routeState.checkout, 'AGENTS.md'), 'Kept in a repository.\n');
    await symlink(path.join(routeState.checkout, 'AGENTS.md'), link());
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'unverified', agentEditable: true });
      expect(await resolveGlobalInstructionFile('claude')).not.toHaveProperty('text');
      // A file no turn can reach needs no proof.
      await rm(link());
      await write(link(), 'Plain.\n');
      expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Plain.\n' });
    } finally { Object.defineProperty(process, 'platform', platform); }
  });

  it('treats a provider folder inside a checkout like the checkout it is in', async () => {
    // A stow-style layout: the provider folder itself lives in a repository a turn can write.
    const stowed = path.join(routeState.checkout, 'claude');
    vi.stubEnv('CLAUDE_CONFIG_DIR', stowed);
    await symlink(path.join(outside, 'secret.txt'), path.join(await mkdir(stowed, { recursive: true }).then(() => stowed), 'CLAUDE.md'));
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'agent-link' });
    await rm(path.join(stowed, 'CLAUDE.md'));
    await write(path.join(stowed, 'CLAUDE.md'), 'Stowed.\n');
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Stowed.\n', agentEditable: true });
    // Directly in the repositories root under another name, it could be a checkout itself.
    const named = path.join(repositories, 'claude-config');
    vi.stubEnv('CLAUDE_CONFIG_DIR', named);
    await mkdir(named);
    await symlink(path.join(outside, 'secret.txt'), path.join(named, 'CLAUDE.md'));
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'agent-link' });
  });

  it.skipIf(process.platform !== 'linux').each([
    ['the file', async () => {
      await rm(path.join(routeState.checkout, 'prompts', 'AGENTS.md'));
      await symlink(path.join(outside, 'secret.txt'), path.join(routeState.checkout, 'prompts', 'AGENTS.md'));
    }],
    ['the folder above it', async () => {
      await write(path.join(outside, 'private', 'AGENTS.md'), 'SYNTHETIC_PRIVATE_KEY\n');
      await rm(path.join(routeState.checkout, 'prompts'), { recursive: true });
      await symlink(path.join(outside, 'private'), path.join(routeState.checkout, 'prompts'));
    }],
  ])('refuses a file when %s is swapped for a link after the path was resolved', async (_, swap) => {
    await write(path.join(routeState.checkout, 'prompts', 'AGENTS.md'), 'Kept in a repository.\n');
    await symlink(path.join(routeState.checkout, 'prompts', 'AGENTS.md'), link());
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Kept in a repository.\n' });
    routeState.beforeRead = async () => { routeState.beforeRead = undefined; await swap(); };
    const swapped = await resolveGlobalInstructionFile('claude');
    expect(swapped).toMatchObject({ issue: 'agent-link' });
    expect(JSON.stringify(swapped)).not.toContain('SYNTHETIC');
  });

  it.each([
    ['the file itself, replaced by a link', async () => {
      await symlink(path.join(outside, 'secret.txt'), path.join(routeState.checkout, 'AGENTS.md'));
    }],
    ['a folder above it, replaced by a link', async () => {
      await write(path.join(outside, 'private', 'AGENTS.md'), 'SYNTHETIC_PRIVATE_KEY\n');
      await symlink(path.join(outside, 'private'), path.join(routeState.checkout, 'prompts'));
      await rm(link());
      await symlink(path.join(routeState.checkout, 'prompts', 'AGENTS.md'), link());
    }],
    ['a link in /tmp', async () => {
      // The temp directory is named elsewhere here, so that each of the two is what refuses its own.
      vi.stubEnv('TMPDIR', await scratch('codeai-instructions-tmpdir-', USER_OWNED));
      const temporary = await scratch('codeai-instructions-tmp-', '/tmp');
      await symlink(path.join(outside, 'secret.txt'), path.join(temporary, 'AGENTS.md'));
      await rm(link());
      await symlink(path.join(temporary, 'AGENTS.md'), link());
    }],
    ['a link in the temp directory the environment names', async () => {
      const temporary = await scratch('codeai-instructions-tmpdir-', USER_OWNED);
      vi.stubEnv('TMPDIR', temporary);
      await symlink(path.join(outside, 'secret.txt'), path.join(temporary, 'AGENTS.md'));
      await rm(link());
      await symlink(path.join(temporary, 'AGENTS.md'), link());
    }],
  ])('refuses %s, and passes nothing', async (_, plant) => {
    await symlink(path.join(routeState.checkout, 'AGENTS.md'), link());
    await plant();
    expect(await resolveGlobalInstructionFile('claude')).toEqual({ displayPath: '~/.claude/CLAUDE.md', name: 'CLAUDE.md', issue: 'agent-link' });
    expect(await turnGlobalInstructions({ dataDir, provider: 'claude', execution: 'local' })).toEqual({ userCustomizations: false });
    const view = await (await GET_INSTRUCTIONS(new Request('http://localhost:3023/api/instructions'))).text();
    expect(view).not.toContain('SYNTHETIC');
    expect(JSON.parse(view).providers.claude).toMatchObject({ issue: 'agent-link', docker: { entries: [], skipped: ['CLAUDE.md is reached through a link an agent turn could repoint'] } });
  });

  it('asks for proof only of a file a turn can reach, and tries once more when the file was replaced under it', async () => {
    await write(link(), 'Plain.\n');
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Plain.\n' });
    // Nothing on the way to a file no turn can write can be swapped, so a save there is never mistaken for one.
    expect(routeState.proofs).toEqual([false]);

    await rm(link());
    await write(path.join(routeState.checkout, 'AGENTS.md'), 'Kept in a repository.\n');
    await symlink(path.join(routeState.checkout, 'AGENTS.md'), link());
    routeState.proofs = [];
    // An editor that saves by replacing the file: the first read finds the old one gone.
    routeState.readAnswers = [{ issue: 'changed' }];
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ text: 'Kept in a repository.\n' });
    expect(routeState.proofs).toEqual([true, true]);
    // A file that keeps changing under the read is not passed.
    routeState.readAnswers = [{ issue: 'changed' }, { issue: 'changed' }];
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'agent-link' });
  });

  it('leaves the provider folders in a home directory that is the repositories root to the user', async () => {
    // Nothing under ~/.claude or ~/.codex is a checkout, and a root that is one has both protected.
    repositories = outside;
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', outside);
    await write(path.join(outside, '.codex', 'AGENTS.md'), 'Shared.\n');
    await symlink(path.join(outside, '.codex', 'AGENTS.md'), link());
    const file = await resolveGlobalInstructionFile('claude');
    expect(file).toMatchObject({ displayPath: '~/.claude/CLAUDE.md → ~/.codex/AGENTS.md', text: 'Shared.\n' });
    expect(file).not.toHaveProperty('agentEditable');
    // Everything else under that root is still a place a turn can write.
    await rm(link());
    await write(path.join(outside, 'dotfiles', 'real.md'), 'Dotfiles.\n');
    await symlink(path.join(outside, 'dotfiles', 'real.md'), path.join(outside, 'dotfiles', 'CLAUDE.md'));
    await symlink(path.join(outside, 'dotfiles', 'CLAUDE.md'), link());
    expect(await resolveGlobalInstructionFile('claude')).toMatchObject({ issue: 'agent-link' });
  });
});

describe('this machine\'s switches and one turn\'s choice', () => {
  const saveSettings = async (contents: string) => write(instructionSettingsPath(dataDir), contents);

  it('is on for both providers without a record, follows a saved one, and is off for both when damaged', async () => {
    expect(await readInstructionSettings(dataDir)).toEqual({ claude: true, codex: true });
    await saveSettings(JSON.stringify({ claude: false, codex: true }));
    expect(await readInstructionSettings(dataDir)).toEqual({ claude: false, codex: true });
    for (const damaged of ['not json', '{"claude":true}', '{"claude":"yes","codex":true}', '{"claude":true,"codex":true,"path":"/etc/passwd"}']) {
      await saveSettings(damaged);
      expect(await readInstructionSettings(dataDir), damaged).toEqual({ claude: false, codex: false, damaged: true });
    }
  });

  it('uses the session\'s choice before the machine setting, and never resolves text for local Codex', async () => {
    await write(claudeFile(), `${MARKER}\n`);
    await write(codexFile(), 'codex rules\n');
    const turn = (provider: AgentProvider, execution: 'local' | 'docker', choice?: GlobalInstructionsChoice) => (
      turnGlobalInstructions({ dataDir, provider, execution, choice })
    );
    const claude = { displayPath: '~/.claude/CLAUDE.md', text: `${MARKER}\n` };
    expect(await turn('claude', 'local')).toEqual({ globalInstructions: claude, userCustomizations: false });
    expect(await turn('claude', 'docker')).toEqual({ globalInstructions: claude, userCustomizations: true });
    expect(await turn('codex', 'docker')).toEqual({ globalInstructions: { displayPath: '~/.codex/AGENTS.md', text: 'codex rules\n' }, userCustomizations: true });
    // Local Codex loads this file itself: it never gets the text a second time.
    expect(await turn('codex', 'local')).toEqual({ userCustomizations: false });
    expect(await turn('codex', 'local', 'global')).toEqual({ userCustomizations: false });
    expect(await turn('claude', 'local', 'isolated')).toEqual({ userCustomizations: false });
    expect(await turn('codex', 'docker', 'isolated')).toEqual({ userCustomizations: false });

    await saveSettings(JSON.stringify({ claude: false, codex: false }));
    expect(await turn('claude', 'local')).toEqual({ userCustomizations: false });
    expect(await turn('codex', 'docker')).toEqual({ userCustomizations: false });
    expect(await turn('claude', 'local', 'global')).toEqual({ globalInstructions: claude, userCustomizations: false });
    expect(await turn('codex', 'docker', 'global')).toMatchObject({ globalInstructions: { text: 'codex rules\n' }, userCustomizations: true });

    // An empty file says nothing, so nothing is framed; a Docker worker may still see the entries.
    await write(claudeFile(), ' \n');
    expect(await turn('claude', 'docker', 'global')).toEqual({ userCustomizations: true });
  });

  it('shows the same choice the server resolves, and nothing while the machine switch is unknown', () => {
    const machine = { claude: true, codex: false };
    expect(effectiveInstructions({ provider: 'claude', execution: 'local', machine })).toBe('global');
    expect(effectiveInstructions({ provider: 'codex', execution: 'docker', machine })).toBe('isolated');
    expect(effectiveInstructions({ provider: 'codex', execution: 'docker', machine, choice: 'global' })).toBe('global');
    expect(effectiveInstructions({ provider: 'claude', machine, choice: 'isolated' })).toBe('isolated');
    // Local Codex always uses its own file, whatever the switch or the session says.
    expect(effectiveInstructions({ provider: 'codex', execution: 'local', machine })).toBe('global');
    expect(effectiveInstructions({ provider: 'codex', machine })).toBe('global');
    expect(effectiveInstructions({ provider: 'claude', execution: 'local' })).toBeUndefined();
  });

  it('says a choice that is on has no file when this machine has none for that agent', () => {
    const file = { passable: true, present: true };
    const none = { passable: false, present: false };
    const line = (provider: AgentProvider, execution: 'local' | 'docker', machine: MachineInstructions, choice?: GlobalInstructionsChoice) => (
      instructionsLine({ provider, execution, machine, choice })
    );
    const on: MachineInstructions = { claude: { enabled: true, ...file }, codex: { enabled: true, ...file } };
    expect(line('claude', 'local', on)).toBe('global');
    expect(line('claude', 'local', on, 'isolated')).toBe('isolated');
    expect(line('claude', 'local', { ...on, claude: { enabled: false, ...file } })).toBe('isolated');
    // A clean installation: the switch is on, and there is nothing to give.
    expect(line('claude', 'local', { ...on, claude: { enabled: true, ...none } })).toBe('unavailable');
    expect(line('claude', 'docker', { ...on, claude: { enabled: false, ...none } }, 'global')).toBe('unavailable');
    expect(line('claude', 'local', { ...on, claude: { enabled: false, ...none } })).toBe('isolated');
    // Local Codex loads its own file, even one CodeAI could not pass; Docker Codex needs the text.
    const tooLarge: MachineInstructions = { ...on, codex: { enabled: true, passable: false, present: true } };
    expect(line('codex', 'local', tooLarge)).toBe('global');
    expect(line('codex', 'docker', tooLarge)).toBe('unavailable');
    expect(line('codex', 'local', { ...on, codex: { enabled: false, ...none } })).toBe('unavailable');
    // An executor's switches and files are its own: only a session's choice is known, and local
    // Codex there loads a file this machine knows nothing about.
    expect(instructionsLine({ provider: 'claude', execution: 'local' })).toBeUndefined();
    expect(instructionsLine({ provider: 'claude', execution: 'local', choice: 'global' })).toBe('global');
    expect(instructionsLine({ provider: 'codex', execution: 'docker', choice: 'isolated' })).toBe('isolated');
    expect(instructionsLine({ provider: 'codex', execution: 'local' })).toBeUndefined();
    expect(instructionsLine({ provider: 'codex', execution: 'local', choice: 'global' })).toBeUndefined();
  });

  it('frames the text under CodeAI\'s own contract and names the Docker folder', () => {
    const file = { displayPath: '~/.claude/CLAUDE.md → ~/.codex/AGENTS.md', text: `${MARKER}\n` };
    expect(frameGlobalInstructions(file)).toBe(`${FRAME_HEAD(file.displayPath)}\n\n${MARKER}\n`);
    expect(frameGlobalInstructions(file, '/user/claude'))
      .toBe(`${FRAME_HEAD(file.displayPath)} The user's customizations are available read-only at \`/user/claude\`.\n\n${MARKER}\n`);
    expect(frameGlobalInstructions(undefined, '/user/codex')).toBe('The user\'s customizations are available read-only at `/user/codex`.');
    expect(frameGlobalInstructions(undefined)).toBeUndefined();
  });
});

describe.sequential('what each provider is given', () => {
  beforeAll(async () => { await chmod(FAKE_CLAUDE, 0o755); await chmod(FAKE_CODEX, 0o755); });
  afterEach(() => { delete process.env.CODEAI_FAKE_CODEX_RECORD; });

  async function claudeArgs(execution: 'local' | 'docker', debug = false): Promise<string[]> {
    const directory = await scratch('codeai-instructions-run-');
    const runner = new ClaudeProcessRunner({ binary: FAKE_CLAUDE, maxOutputBytes: 100_000, killGraceMs: 50, debug });
    await runner.run({
      runId: crypto.randomUUID(),
      checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id: crypto.randomUUID(), action: 'start' },
      prompt: 'question',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig(), 'ask'), timeoutMs: 5_000 },
      signal: new AbortController().signal,
      emit() {},
      ...await turnGlobalInstructions({ dataDir, provider: 'claude', execution }),
    });
    return (JSON.parse(await readFile(path.join(directory, 'fake-invocation.json'), 'utf8')) as { args: string[] }).args;
  }

  it('passes Claude the framed file with --append-system-prompt by default, and nothing once switched off', async () => {
    await write(claudeFile(), `${MARKER}\n`);
    const args = await claudeArgs('local');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(`${FRAME_HEAD('~/.claude/CLAUDE.md')}\n\n${MARKER}\n`);
    // Safe mode stays on: only words are added.
    expect(args).toContain('--safe-mode');
    for (const mode of ['ask', 'plan', 'agent'] as const) expect(requiredFlagsForMode(mode)).toContain('--append-system-prompt');

    // A debug log names the size of the user's text, never the text.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await claudeArgs('local', true);
    const spawnLine = logged.mock.calls.map(([line]) => String(line)).find((line) => line.includes(' spawn '))!;
    expect(spawnLine).toMatch(/--append-system-prompt <\d+B>/);
    expect(logged.mock.calls.flat().join('\n')).not.toContain('PINEAPPLE');

    await write(instructionSettingsPath(dataDir), JSON.stringify({ claude: false, codex: true }));
    expect(await claudeArgs('local')).not.toContain('--append-system-prompt');
    expect(buildClaudeArgs({
      session: { id: 'session', action: 'resume' }, attachmentDirectory: '/run', policy: resolveAgentPolicy(getConfig(), 'ask'),
    })).not.toContain('--append-system-prompt');
  });

  async function codexInstructions(
    execution: 'local' | 'docker', action: 'start' | 'resume', forced?: { displayPath: string; text: string },
  ): Promise<unknown> {
    const directory = await scratch('codeai-instructions-codex-');
    process.env.CODEAI_FAKE_CODEX_RECORD = path.join(directory, 'record.json');
    const docker = execution === 'docker';
    const runner = new CodexProcessRunner({
      binary: FAKE_CODEX, maxOutputBytes: 100_000, killGraceMs: 50,
      // A worker's transport, run here against the offline fixture.
      ...(docker ? {
        transport: { spawn: (binary, args) => spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] }) },
        imagePaths: [], customizationsPath: '/user/codex',
      } : {}),
    });
    await runner.run({
      runId: crypto.randomUUID(),
      checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id: action === 'resume' ? 'codex-thread-resume' : undefined, action },
      prompt: 'Mode: ASK\n\n[User message]\nExplain this',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy({ ...getConfig(), dockerEnabled: docker }, 'ask', execution), timeoutMs: 5_000 },
      signal: new AbortController().signal,
      emit() {},
      ...await turnGlobalInstructions({ dataDir, provider: 'codex', execution }),
      ...(forced ? { globalInstructions: forced } : {}),
    });
    const { requests } = JSON.parse(await readFile(process.env.CODEAI_FAKE_CODEX_RECORD, 'utf8')) as { requests: Array<{ method: string; params: Record<string, unknown> }> };
    return requests.find((request) => request.method === `thread/${action}`)!.params.developerInstructions;
  }

  it('sends Docker Codex the framed file in developerInstructions at start and resume, and local Codex only CodeAI\'s own', async () => {
    await write(codexFile(), `${MARKER}\n`);
    const framed = `${codexDeveloperInstructions('ask')}\n\n${FRAME_HEAD('~/.codex/AGENTS.md')} The user's customizations are available read-only at \`/user/codex\`.\n\n${MARKER}\n`;
    expect(await codexInstructions('docker', 'start')).toBe(framed);
    expect(await codexInstructions('docker', 'resume')).toBe(framed);
    expect(await codexInstructions('local', 'start')).toBe(codexDeveloperInstructions('ask'));
    expect(await codexInstructions('local', 'resume')).toBe(codexDeveloperInstructions('ask'));
    // Even handed the text, a local turn sends only CodeAI's own: local Codex loads the file itself.
    expect(await codexInstructions('local', 'start', { displayPath: '~/.codex/AGENTS.md', text: `${MARKER}\n` })).toBe(codexDeveloperInstructions('ask'));
    expect(codexDeveloperInstructions('ask')).not.toContain(MARKER);
  });
});

function json(url: string, method: string, body: unknown, origin: string | null = 'http://localhost:3023'): Request {
  return new Request(url, {
    method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
  });
}

const patchSwitch = (body: unknown, origin?: string | null) => PATCH_INSTRUCTIONS(json('http://localhost:3023/api/instructions', 'PATCH', body, origin));
const readView = async () => (await GET_INSTRUCTIONS(new Request('http://localhost:3023/api/instructions'))).json() as Promise<GlobalInstructionsView>;

describe('GET and PATCH /api/instructions', () => {
  it('returns each provider\'s switch, path, text, import flag, and issue', async () => {
    // Only Claude has imports: the same words in Codex's file are just words.
    await write(codexFile(), 'Follow @docs/style.md.\n');
    expect((await readView()).providers.codex).toMatchObject({ text: 'Follow @docs/style.md.\n', imports: false });
    await write(claudeFile(), 'Follow @docs/style.md.\n');
    await write(codexFile(), 'x'.repeat(GLOBAL_INSTRUCTIONS_BYTES + 1));
    expect(await readView()).toEqual({
      providers: {
        claude: { enabled: true, displayPath: '~/.claude/CLAUDE.md', text: 'Follow @docs/style.md.\n', imports: true, docker: { entries: ['CLAUDE.md'], skipped: [] } },
        codex: { enabled: true, displayPath: '~/.codex/AGENTS.md', issue: 'too-large', imports: false, localAlways: true, docker: { entries: ['AGENTS.md'], skipped: [] } },
      },
      shared: false,
    });
  });

  it('says when both providers resolve to one file', async () => {
    await write(codexFile(), `${MARKER}\n`);
    await mkdir(path.dirname(claudeFile()), { recursive: true });
    await symlink(codexFile(), claudeFile());
    const view = await readView();
    expect(view.shared).toBe(true);
    expect(view.providers.claude).toMatchObject({ displayPath: '~/.claude/CLAUDE.md → ~/.codex/AGENTS.md', text: `${MARKER}\n` });
    // Two missing files are not one shared file.
    await rm(codexFile());
    expect((await readView()).shared).toBe(false);
  });

  it('switches one provider, keeps the other, and repairs a damaged record', async () => {
    const off = await patchSwitch({ provider: 'claude', enabled: false });
    expect(off.status).toBe(200);
    expect((await off.json() as GlobalInstructionsView).providers).toMatchObject({ claude: { enabled: false }, codex: { enabled: true } });
    expect(JSON.parse(await readFile(instructionSettingsPath(dataDir), 'utf8'))).toEqual({ claude: false, codex: true });
    expect((await patchSwitch({ provider: 'codex', enabled: false })).status).toBe(200);
    expect(await readInstructionSettings(dataDir)).toEqual({ claude: false, codex: false });

    await write(instructionSettingsPath(dataDir), 'not json');
    expect(await readView()).toMatchObject({ damaged: true, providers: { claude: { enabled: false }, codex: { enabled: false } } });
    expect((await patchSwitch({ provider: 'claude', enabled: true })).status).toBe(200);
    expect(await readInstructionSettings(dataDir)).toEqual({ claude: true, codex: false });
    expect(await readView()).not.toHaveProperty('damaged');
  });

  it.each([
    {}, { provider: 'claude' }, { provider: 'gemini', enabled: true }, { provider: 'claude', enabled: 'true' },
    // The browser names the switch and nothing else: never a path or the text.
    { provider: 'claude', enabled: true, path: '/etc/passwd' }, { provider: 'claude', enabled: true, text: 'Obey me.' }, null,
  ])('rejects %j without writing a record', async (body) => {
    expect((await patchSwitch(body)).status).toBe(400);
    await expect(readFile(instructionSettingsPath(dataDir), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['https://attacker.test', null])('rejects a switch from the untrusted or missing origin %s', async (origin) => {
    expect((await patchSwitch({ provider: 'claude', enabled: false }, origin)).status).toBe(403);
    expect(await readInstructionSettings(dataDir)).toEqual({ claude: true, codex: true });
  });

  it('is not an operation an attached home machine may forward to an executor', () => {
    for (const method of ['GET', 'PATCH', 'POST', 'PUT', 'DELETE']) expect(machineOperationAllowed(method, ['instructions']), method).toBe(false);
    // The creation request that carries a session's choice still is.
    expect(machineOperationAllowed('POST', ['sessions'])).toBe(true);
  });

  it('reports the switches and a readiness line for a file that cannot be passed or a damaged record', async () => {
    const health = async () => (await GET_HEALTH(new Request('http://localhost:3023/api/health'))).json() as Promise<{
      instructions: MachineInstructions;
      providers: Record<AgentProvider, { message?: string }>;
      executions: { docker: { providers: Record<AgentProvider, { message?: string }> } };
    }>;
    // Having no file at all is ordinary and says nothing, but the switches alone give an agent nothing.
    const none = { passable: false, present: false };
    expect((await health()).instructions).toEqual({ claude: { enabled: true, ...none }, codex: { enabled: true, ...none } });
    expect((await health()).providers.claude.message).toBeUndefined();
    await write(claudeFile(), 'Be brief.\n');
    await write(codexFile(), ' \n');
    expect((await health()).instructions).toEqual({ claude: { enabled: true, passable: true, present: true }, codex: { enabled: true, ...none } });

    await write(claudeFile(), 'x'.repeat(GLOBAL_INSTRUCTIONS_BYTES + 1));
    await write(codexFile(), Buffer.from([0xff, 0xfe]));
    const unreadable = await health();
    // Health reaches an attached home machine, so its line names the file and no path.
    expect(unreadable.providers.claude.message).toBe('Claude runs without your global instructions: CLAUDE.md is larger than 32 KiB.');
    // Local Codex loads its own file, so the line is Docker Codex's alone.
    expect(unreadable.providers.codex.message).toBeUndefined();
    expect(unreadable.executions.docker.providers.codex.message).toBe('Docker Codex runs without your global instructions: AGENTS.md is not UTF-8 text.');
    // Local Codex still loads a file CodeAI cannot pass; nothing else gets it.
    expect(unreadable.instructions).toEqual({
      claude: { enabled: true, passable: false, present: true }, codex: { enabled: true, passable: false, present: true },
    });
    // A folder where the file should be is nothing local Codex can load either.
    await rm(codexFile());
    await mkdir(codexFile());
    expect((await health()).instructions.codex).toEqual({ enabled: true, passable: false, present: false });
    await rm(codexFile(), { recursive: true });
    await write(codexFile(), Buffer.from([0xff, 0xfe]));
    // The Docker providers say nothing about instructions while Docker itself is unavailable.
    routeState.dockerAvailable = false;
    expect((await health()).executions.docker.providers.codex.message).toBe('Docker execution is disabled on this machine.');
    routeState.dockerAvailable = true;

    // A switched-off provider has nothing to report.
    await patchSwitch({ provider: 'claude', enabled: false });
    expect(await health()).toMatchObject({ instructions: { claude: { enabled: false }, codex: { enabled: true } } });
    expect((await health()).providers.claude.message).toBeUndefined();

    await write(instructionSettingsPath(dataDir), '{"claude":true}');
    const damaged = await health();
    expect(damaged.instructions).toMatchObject({ claude: { enabled: false }, codex: { enabled: false } });
    expect(damaged.providers.claude.message).toContain('The global instructions setting on this machine is damaged');
  });
});

describe.sequential('a session\'s own choice', () => {
  let store: SessionStore;
  beforeEach(() => {
    store = getSessionStore(dataDir, 'Home');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => { await store.close(); });

  const createSession = (body: Record<string, unknown>) => POST_SESSION(json('http://localhost:3023/api/sessions', 'POST', body));
  const created = async (body: Record<string, unknown>) => {
    const response = await createSession(body);
    expect(response.status).toBe(201);
    return (await response.json() as { session: DurableSession }).session;
  };
  const projectId = async () => (await store.createProject(`Project ${crypto.randomUUID()}`, ['checkout-a'])).id;

  async function send(session: Pick<DurableSession, 'id' | 'primaryAgentId'>, extra: Record<string, unknown> = {}): Promise<number> {
    const response = await POST_MESSAGE(json('http://localhost:3023/api/agent/message', 'POST', {
      sessionId: session.id, messageId: crypto.randomUUID(), participantId: session.primaryAgentId, text: 'Go.', diagramAttachments: [], mode: 'ask', ...extra,
    }));
    await response.text();
    await vi.waitFor(() => expect(runRegistry.currentRuns).toEqual([]));
    return response.status;
  }

  it('stores the choice at the next session format, and leaves a session without one where it was', async () => {
    expect(INSTRUCTIONS_SESSION_VERSION).toBe(7);
    expect(MAX_READABLE_SESSION_VERSION).toBe(7);
    const plain = await created({ provider: 'claude', projectId: await projectId() });
    expect(plain.version).toBe(4);
    expect(plain).not.toHaveProperty('instructions');
    for (const instructions of ['global', 'isolated'] as const) {
      const session = await created({ provider: 'claude', projectId: await projectId(), instructions });
      // The public snapshot carries it, and the stored record is the format that holds the field.
      expect(session).toMatchObject({ version: 7, instructions });
      const stored = await store.getSession(session.id);
      expect(stored).toMatchObject({ version: 7, instructions });
      expect(publicSession(stored).instructions).toBe(instructions);
      // An older format cannot hold the field, so an older CodeAI never reads it as something else.
      for (const version of [4, 5, 6]) expect(durableSessionSchema.safeParse({ ...stored, version }).success, `version ${version}`).toBe(false);
    }
    expect(createSessionRequestSchema.safeParse({ provider: 'claude', instructions: 'default' }).success).toBe(false);
    expect((await createSession({ provider: 'claude', instructions: 'everything' })).status).toBe(400);
  });

  it('keeps the version when a later message would raise a lower one', async () => {
    const session = await created({ provider: 'codex', projectId: await projectId(), instructions: 'global' });
    const human = session.participants.find((participant) => participant.kind === 'human')!;
    const message = (extra: Record<string, unknown>) => ({
      id: crypto.randomUUID(), role: 'user' as const, authorId: human.id, addressedParticipantId: session.primaryAgentId,
      text: 'Go.', createdAt: new Date().toISOString(), status: 'sending' as const, diagramAttachments: [], ...extra,
    });
    // Report evidence needs version 5 and an Auto message version 6: neither lowers a version 7 session.
    const report = { reportId: '2026-09-30T10-00-00.000Z-capture', receivedAt: '2026-09-30T10:00:00.000Z', kind: 'capture' as const, screenshotIncluded: false, errorCount: 0 };
    expect((await store.appendUserMessage(session.id, message({ reportAttachments: [report] }))).session).toMatchObject({ version: 7, instructions: 'global' });
    expect((await store.appendUserMessage(session.id, message({ mode: 'auto' }))).session).toMatchObject({ version: 7, instructions: 'global' });
    expect((await store.getSession(session.id)).version).toBe(7);
  });

  it('gives each turn the session\'s choice before the machine setting', async () => {
    await write(claudeFile(), `${MARKER}\n`);
    const project = await projectId();
    const claude = { displayPath: '~/.claude/CLAUDE.md', text: `${MARKER}\n` };
    const turn = async (instructions?: GlobalInstructionsChoice) => {
      routeState.runs = [];
      expect(await send(await created({ provider: 'claude', projectId: project, ...(instructions ? { instructions } : {}) }))).toBe(200);
      return routeState.runs;
    };
    expect(await turn()).toEqual([{ provider: 'claude', globalInstructions: claude, userCustomizations: false }]);
    expect(await turn('isolated')).toEqual([{ provider: 'claude', globalInstructions: undefined, userCustomizations: false }]);

    await patchSwitch({ provider: 'claude', enabled: false });
    expect(await turn()).toEqual([{ provider: 'claude', globalInstructions: undefined, userCustomizations: false }]);
    expect(await turn('global')).toEqual([{ provider: 'claude', globalInstructions: claude, userCustomizations: false }]);
  });

  it('refuses a Codex agent in an isolated local session, at creation and when one is added', async () => {
    const project = await projectId();
    const refused = await createSession({ provider: 'codex', projectId: project, instructions: 'isolated' });
    expect([refused.status, await refused.json()]).toEqual([409, { error: LOCAL_CODEX_ISOLATION_MESSAGE }]);
    expect(await store.listSessions()).toEqual([]);

    const isolated = await created({ provider: 'claude', projectId: project, instructions: 'isolated' });
    const add = (session: DurableSession, provider: AgentProvider) => POST_PARTICIPANT(
      json(`http://localhost:3023/api/sessions/${session.id}/participants`, 'POST', { provider, role: 'reviewer', requestId: crypto.randomUUID() }),
      { params: Promise.resolve({ sessionId: session.id }) },
    );
    const added = await add(isolated, 'codex');
    expect([added.status, await added.json()]).toEqual([409, { error: LOCAL_CODEX_ISOLATION_MESSAGE }]);
    expect((await add(isolated, 'claude')).status).toBe(201);
    expect((await store.getSession(isolated.id)).participants.filter((participant) => participant.kind === 'agent')).toHaveLength(2);

    // Docker Codex gets only what CodeAI sends, so it can be isolated; every other local choice allows Codex.
    const docker = await created({ provider: 'codex', projectId: project, execution: 'docker', instructions: 'isolated' });
    expect(docker).toMatchObject({ execution: 'docker', instructions: 'isolated' });
    expect((await add(docker, 'codex')).status).toBe(201);
    expect((await add(await created({ provider: 'claude', projectId: project, instructions: 'global' }), 'codex')).status).toBe(201);
    expect((await add(await created({ provider: 'claude', projectId: project }), 'codex')).status).toBe(201);
  });

  it('copies the choice to a session made from a source session', async () => {
    const source = await created({ provider: 'claude', projectId: await projectId(), instructions: 'isolated' });
    const continued = await created({ provider: 'claude', sourceSessionId: source.id, execution: 'docker' });
    expect(continued).toMatchObject({ version: 7, instructions: 'isolated', execution: 'docker' });
    const plain = await created({ provider: 'claude', projectId: await projectId() });
    expect(await created({ provider: 'claude', sourceSessionId: plain.id, execution: 'local' })).not.toHaveProperty('instructions');
    // An isolated Docker Codex session cannot continue as local Codex, which cannot be isolated.
    const docker = await created({ provider: 'codex', projectId: await projectId(), execution: 'docker', instructions: 'isolated' });
    const refused = await createSession({ provider: 'codex', sourceSessionId: docker.id, execution: 'local' });
    expect([refused.status, await refused.json()]).toEqual([409, { error: LOCAL_CODEX_ISOLATION_MESSAGE }]);
  });
});
