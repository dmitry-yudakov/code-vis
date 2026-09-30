import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDockerCustomizations } from '@/server/execution/dockerCustomizations';
import { validateDockerCheckout } from '@/server/execution/dockerProfile';
import { userOwnedParent } from './userOwned';

const directories: string[] = [];
let home: string;
let dataDir: string;
let repositories: string;

// The temp directory is a place an agent turn can write, so the user's own folders live elsewhere.
async function scratch(prefix: string, parent = userOwnedParent()): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(parent, prefix)));
  directories.push(directory);
  return directory;
}

const claude = (...parts: string[]) => path.join(home, '.claude', ...parts);
const codex = (...parts: string[]) => path.join(home, '.codex', ...parts);
const resolve = (provider: 'claude' | 'codex') => resolveDockerCustomizations(provider, { dataDir, repositoriesRoot: repositories });

beforeEach(async () => {
  home = await scratch('codeai-customizations-home-');
  repositories = await scratch('codeai-customizations-repositories-', os.tmpdir());
  dataDir = path.join(home, '.code-ai', 'web2');
  await mkdir(dataDir, { recursive: true });
  await mkdir(claude(), { recursive: true });
  await mkdir(codex(), { recursive: true });
  vi.stubEnv('HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
  vi.stubEnv('CODEX_HOME', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the customizations a Docker worker may see', () => {
  it('names only the allowlisted entries that exist, each under /user/<provider>', async () => {
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: [] });
    await writeFile(claude('CLAUDE.md'), 'Be brief.\n');
    for (const name of ['skills', 'agents', 'commands']) await mkdir(claude(name));
    // What else a provider folder holds is never named, whatever it is called.
    for (const name of ['settings.json', '.credentials.json', 'history.jsonl', 'AGENTS.md']) await writeFile(claude(name), 'private');
    for (const name of ['projects', 'sessions', 'plugins', 'prompts']) await mkdir(claude(name));
    expect(await resolve('claude')).toEqual({
      mounts: ['CLAUDE.md', 'skills', 'agents', 'commands'].map((name) => ({ name, source: claude(name), target: `/user/claude/${name}` })),
      skipped: [],
    });

    await writeFile(codex('AGENTS.md'), 'Be brief.\n');
    await writeFile(codex('AGENTS.override.md'), 'Be briefer.\n');
    for (const name of ['skills', 'prompts', 'sessions', 'agents']) await mkdir(codex(name));
    for (const name of ['auth.json', 'config.toml', 'logs_2.sqlite', 'CLAUDE.md']) await writeFile(codex(name), 'private');
    expect(await resolve('codex')).toEqual({
      mounts: ['AGENTS.md', 'AGENTS.override.md', 'skills', 'prompts'].map((name) => ({ name, source: codex(name), target: `/user/codex/${name}` })),
      skipped: [],
    });
  });

  it('binds what a link resolves to, and treats a link to nothing as absent', async () => {
    const shared = await scratch('codeai-customizations-shared-');
    await writeFile(path.join(shared, 'AGENTS.md'), 'Shared.\n');
    await mkdir(path.join(shared, 'skills'));
    await symlink(path.join(shared, 'AGENTS.md'), claude('CLAUDE.md'));
    await symlink(path.join(shared, 'skills'), claude('skills'));
    await symlink(path.join(shared, 'gone'), claude('agents'));
    // Docker resolves no mount through a link, so the source is always the canonical path.
    expect(await resolve('claude')).toEqual({
      mounts: [
        { name: 'CLAUDE.md', source: path.join(shared, 'AGENTS.md'), target: '/user/claude/CLAUDE.md' },
        { name: 'skills', source: path.join(shared, 'skills'), target: '/user/claude/skills' },
      ],
      skipped: [],
    });
  });

  it('skips and reports an entry that resolves to, or to a folder holding, anything protected', async () => {
    const protectedTargets: Array<[string, string]> = [
      ['the home directory', home],
      ['the provider folder itself', claude()],
      ['the other provider\'s folder', codex()],
      ['the data directory', dataDir],
      ['a folder inside the data directory', path.join(dataDir, 'session-store-v2')],
      ['the running installation', process.cwd()],
      ['a folder of the running installation', path.resolve('src')],
      ['a folder holding the installation', path.dirname(process.cwd())],
      ['Docker\'s configuration', path.join(home, '.docker')],
      ['a folder of the user\'s configuration', path.join(home, '.config', 'gh')],
      ['a private folder of a provider folder', codex('sessions')],
      ['the filesystem root', '/'],
    ];
    for (const directory of [path.join(dataDir, 'session-store-v2'), path.join(home, '.docker'), path.join(home, '.config', 'gh'), codex('sessions')]) await mkdir(directory, { recursive: true });
    for (const [label, target] of protectedTargets) {
      await rm(claude('skills'), { force: true });
      await symlink(target, claude('skills'));
      expect(await resolve('claude'), label).toEqual({ mounts: [], skipped: ['skills/ resolves to a protected folder'] });
    }
    // A neighbour of a protected folder is an ordinary place for the user's own skills.
    await rm(claude('skills'));
    await mkdir(path.join(home, 'dotfiles', 'skills'), { recursive: true });
    await symlink(path.join(home, 'dotfiles', 'skills'), claude('skills'));
    expect((await resolve('claude')).mounts).toEqual([{ name: 'skills', source: path.join(home, 'dotfiles', 'skills'), target: '/user/claude/skills' }]);
  });

  it('protects the home directory itself, even when it is reached through a link and holds no known folder', async () => {
    // Everything CodeAI knows by name lives elsewhere, so only the home directory's own entry can refuse this.
    const linkedHome = path.join(await scratch('codeai-customizations-link-'), 'home');
    await symlink(home, linkedHome);
    const configured = await scratch('codeai-customizations-configured-');
    await rm(path.join(home, '.code-ai'), { recursive: true });
    await rm(claude(), { recursive: true });
    await rm(codex(), { recursive: true });
    vi.stubEnv('HOME', linkedHome);
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(configured, 'claude'));
    vi.stubEnv('CODEX_HOME', path.join(configured, 'codex'));
    await mkdir(path.join(configured, 'claude'));
    await symlink(home, path.join(configured, 'claude', 'skills'));
    expect(await resolveDockerCustomizations('claude', { dataDir: path.join(configured, 'data'), repositoriesRoot: repositories }))
      .toEqual({ mounts: [], skipped: ['skills/ resolves to a protected folder'] });
  });

  it('binds nothing from where an agent turn can write, real folder or link', async () => {
    // The user keeps their skills in a repository, which a Docker Agent turn for it can rewrite. Docker
    // resolves the source again when the worker starts, so a folder there could still be swapped.
    const kept = path.join(repositories, 'dotfiles', 'skills');
    await mkdir(kept, { recursive: true });
    await symlink(kept, claude('skills'));
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: ['skills/ is under the repositories root or a temp directory, where an agent turn can change it'] });
    // Such a turn swaps the folder for a link to the user's keys: that link is not even followed.
    const keys = path.join(home, '.ssh');
    await mkdir(keys);
    await rm(kept, { recursive: true });
    await symlink(keys, kept);
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: ['skills/ is reached through a link an agent turn could repoint'] });
    // The same for a temp folder, which a local Auto turn can write.
    await rm(claude('skills'));
    await symlink(await scratch('codeai-customizations-tmp-', os.tmpdir()), claude('skills'));
    expect((await resolve('claude')).skipped).toEqual(['skills/ is under the repositories root or a temp directory, where an agent turn can change it']);
  });

  it('keeps a checkout from holding the provider folder a variable names', async () => {
    const checkout = await scratch('codeai-customizations-checkout-', os.tmpdir());
    await mkdir(path.join(checkout, 'codex-home'));
    await expect(validateDockerCheckout(checkout, { dataDir })).resolves.toBeDefined();
    vi.stubEnv('CODEX_HOME', path.join(checkout, 'codex-home'));
    await expect(validateDockerCheckout(checkout, { dataDir })).rejects.toThrow('provider storage');
  });

  it('binds the entries of a provider folder kept in the user\'s configuration folder, and nothing else from there', async () => {
    const xdg = path.join(home, '.config', 'claude');
    vi.stubEnv('CLAUDE_CONFIG_DIR', xdg);
    await mkdir(path.join(xdg, 'skills'), { recursive: true });
    await mkdir(path.join(home, '.config', 'gh'));
    await symlink(path.join(home, '.config', 'gh'), path.join(xdg, 'agents'));
    expect(await resolve('claude')).toEqual({
      mounts: [{ name: 'skills', source: path.join(xdg, 'skills'), target: '/user/claude/skills' }],
      skipped: ['agents/ resolves to a protected folder'],
    });
  });

  it('skips a folder that holds the user\'s configuration when that is kept elsewhere', async () => {
    // Dotfiles outside the home directory: ~/.config is a link into them, so nothing under the home directory holds it.
    const dotfiles = await scratch('codeai-customizations-dotfiles-');
    await mkdir(path.join(dotfiles, 'config', 'gh'), { recursive: true });
    await writeFile(path.join(dotfiles, 'config', 'gh', 'hosts.yml'), 'oauth_token: SYNTHETIC_TOKEN\n');
    await mkdir(path.join(dotfiles, 'skills'));
    await symlink(path.join(dotfiles, 'config'), path.join(home, '.config'));
    await symlink(dotfiles, claude('skills'));
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: ['skills/ resolves to a protected folder'] });
    // A neighbour of the configuration there is an ordinary place for skills.
    await rm(claude('skills'));
    await symlink(path.join(dotfiles, 'skills'), claude('skills'));
    expect((await resolve('claude')).mounts).toEqual([{ name: 'skills', source: path.join(dotfiles, 'skills'), target: '/user/claude/skills' }]);
  });

  it('keeps the home folder of a provider private when a variable names another folder, and a folder holding one', async () => {
    const configured = await scratch('codeai-customizations-configured-');
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(configured, 'claude'));
    vi.stubEnv('CODEX_HOME', path.join(configured, 'elsewhere', 'codex'));
    await mkdir(path.join(configured, 'claude'));
    await mkdir(path.join(configured, 'elsewhere', 'codex'), { recursive: true });
    await mkdir(claude('projects'));
    // ~/.claude is no longer the folder in use, and still holds transcripts and credentials.
    for (const [target, label] of [[claude('projects'), 'inside it'], [claude(), 'the folder'], [path.join(configured, 'elsewhere'), 'a folder holding the other provider\'s']] as const) {
      await rm(path.join(configured, 'claude', 'skills'), { force: true });
      await symlink(target, path.join(configured, 'claude', 'skills'));
      expect(await resolve('claude'), label).toEqual({ mounts: [], skipped: ['skills/ resolves to a protected folder'] });
    }
  });

  it('says so when an entry cannot be read', async () => {
    await symlink(claude('agents'), claude('skills'));
    await symlink(claude('skills'), claude('agents'));
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: ['skills/ cannot be read', 'agents/ cannot be read'] });
  });

  it('leaves the provider folders in a home directory that is the repositories root to the user', async () => {
    repositories = home;
    await mkdir(claude('skills'));
    expect((await resolve('claude')).mounts).toEqual([{ name: 'skills', source: claude('skills'), target: '/user/claude/skills' }]);
    // Anything else under that root is still where a turn can write.
    await mkdir(path.join(home, 'dotfiles', 'agents'), { recursive: true });
    await symlink(path.join(home, 'dotfiles', 'agents'), claude('agents'));
    expect((await resolve('claude')).skipped).toEqual(['agents/ is under the repositories root or a temp directory, where an agent turn can change it']);
  });

  it('skips and reports an entry of the wrong kind or with a path Docker cannot mount', async () => {
    await mkdir(claude('CLAUDE.md'));
    await writeFile(claude('skills'), 'not a folder');
    const awkward = path.join(home, 'with,comma');
    await mkdir(awkward);
    await symlink(awkward, claude('agents'));
    expect(await resolve('claude')).toEqual({
      mounts: [],
      skipped: ['CLAUDE.md is not a regular file', 'skills/ is not a folder', 'agents/ resolves to a path Docker cannot mount'],
    });
  });

  it('reads the folder each provider\'s variable names', async () => {
    const configured = await scratch('codeai-customizations-configured-');
    await writeFile(path.join(configured, 'CLAUDE.md'), 'Configured.\n');
    await writeFile(claude('CLAUDE.md'), 'Default.\n');
    vi.stubEnv('CLAUDE_CONFIG_DIR', configured);
    expect((await resolve('claude')).mounts).toEqual([{ name: 'CLAUDE.md', source: path.join(configured, 'CLAUDE.md'), target: '/user/claude/CLAUDE.md' }]);
    // The configured folder is now the provider folder that must not be bound whole,
    await symlink(configured, path.join(configured, 'skills'));
    expect((await resolve('claude')).skipped).toEqual(['skills/ resolves to a protected folder']);
    // nor inside a folder that holds it.
    const nested = path.join(configured, 'nested');
    await mkdir(nested);
    vi.stubEnv('CLAUDE_CONFIG_DIR', nested);
    await symlink(configured, path.join(nested, 'agents'));
    expect(await resolve('claude')).toEqual({ mounts: [], skipped: ['agents/ resolves to a protected folder'] });
  });
});
