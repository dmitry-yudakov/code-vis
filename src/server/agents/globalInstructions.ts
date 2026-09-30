import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { namesOpenFiles, readBoundedTextFile } from '@/server/boundedTextFile';
import type { AppConfig } from '@/server/config';
import { within } from '@/server/execution/dockerProfile';
import {
  GLOBAL_INSTRUCTIONS_BYTES, INSTRUCTION_ISSUE_TEXT, effectiveInstructions,
} from '@/shared/globalInstructions';
import { PROVIDER_LABELS } from '@/shared/participants';
import { instructionSettingsSchema } from '@/shared/protocol';
import type {
  AgentExecution, AgentProvider, GlobalInstructions, GlobalInstructionsChoice, InstructionFileIssue, MachineInstructions,
} from '@/shared/types';
import { defaultProviderFolder, providerFolder } from './providerFolder';

const PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];

/** In the provider's own order: Codex uses the first of its two that holds any text. */
const INSTRUCTION_FILES: Record<AgentProvider, readonly string[]> = {
  claude: ['CLAUDE.md'],
  codex: ['AGENTS.override.md', 'AGENTS.md'],
};

/**
 * The only entries of the user's provider folder CodeAI reads or lets a Docker worker see. An
 * allowlist, not the folder: beside these it holds credentials, settings that can carry tokens, and
 * every project's transcripts.
 */
export const PROVIDER_CUSTOMIZATIONS: Record<AgentProvider, ReadonlyArray<{ name: string; kind: 'file' | 'directory' }>> = {
  claude: [
    { name: 'CLAUDE.md', kind: 'file' }, { name: 'skills', kind: 'directory' },
    { name: 'agents', kind: 'directory' }, { name: 'commands', kind: 'directory' },
  ],
  codex: [
    { name: 'AGENTS.md', kind: 'file' }, { name: 'AGENTS.override.md', kind: 'file' },
    { name: 'skills', kind: 'directory' }, { name: 'prompts', kind: 'directory' },
  ],
};

type AgentRoots = Pick<AppConfig, 'repositoriesRoot'>;
type UserPath = { realPath: string } | { issue: Extract<InstructionFileIssue, 'missing' | 'unreadable' | 'agent-link' | 'protected'> };

const canonical = (target: string) => realpath(target).catch(() => path.resolve(target));

/**
 * Whether an agent turn can write at a canonical path without asking: a Docker Agent turn writes its
 * checkout, a local Auto turn its checkout and the temp directories, and every checkout lies under
 * the repositories root. The whole root counts, not today's checkouts, because a turn can make its
 * own folder stop looking like one.
 *
 * One exception keeps a root as wide as the home directory usable. A provider folder that sits
 * directly in the root under its own name is never a checkout, and if the root itself is one, the
 * Auto sandbox protects that name and Docker refuses the checkout.
 */
export async function agentWritable(config: AgentRoots): Promise<(location: string) => boolean> {
  const [root, ...temporary] = await Promise.all([config.repositoriesRoot, os.tmpdir(), '/tmp'].map(canonical));
  const own = (await Promise.all(PROVIDERS.map((provider) => canonical(providerFolder(provider)))))
    .filter((folder) => path.dirname(folder) === root && ['.claude', '.codex'].includes(path.basename(folder)));
  return (location) => temporary.some((folder) => within(folder, location))
    || (within(root, location) && !own.some((folder) => within(folder, location)));
}

/** Every folder that holds a provider's private files: the one in use and the one in the home directory. */
export async function providerFolders(): Promise<Array<{ provider: AgentProvider; folder: string }>> {
  const folders = await Promise.all(PROVIDERS.flatMap((provider) => (
    [providerFolder(provider), defaultProviderFolder(provider)].map(async (folder) => ({ provider, folder: await canonical(folder) }))
  )));
  return folders.filter((entry, index) => folders.findIndex((other) => other.provider === entry.provider && other.folder === entry.folder) === index);
}

/**
 * Resolves one of the user's own paths as the kernel would, with two refusals.
 *
 * A symbolic link that lives where an agent turn can write is not followed: a turn that edits a
 * checkout could repoint it at any file the user can read, and the next turn would be handed that
 * file as instructions or see it bound into a worker.
 *
 * A path that ends inside a provider folder must be one of that folder's allowlisted entries, so no
 * link makes CodeAI read a credential or another project's transcripts.
 *
 * The answer is only as good as the moment it was made. Whoever opens a path a turn can reach must
 * prove the handle is that file (`readBoundedTextFile` with `exactly`), or not use it.
 */
export async function resolveUserPath(target: string, config: AgentRoots): Promise<UserPath> {
  const turnCanWrite = await agentWritable(config);
  const { root } = path.parse(path.resolve(target));
  // A trailing separator asks for a folder, as `name/.` does.
  const parts = (value: string) => [...value.split(path.sep).filter(Boolean), ...(value.endsWith(path.sep) ? ['.'] : [])];
  const pending = parts(path.resolve(target).slice(root.length));
  let resolved = root;
  for (let links = 0; pending.length;) {
    // `resolved` holds no link, so a `..` from a link's text leaves its real parent, as for the kernel.
    const next = path.join(resolved, pending.shift()!);
    const info = await lstat(next).catch((error: NodeJS.ErrnoException) => error);
    if (info instanceof Error) return { issue: ['ENOENT', 'ENOTDIR'].includes(info.code || '') ? 'missing' : 'unreadable' };
    if (!info.isSymbolicLink()) {
      // Nothing lies beyond a file.
      if (pending.length && !info.isDirectory()) return { issue: 'missing' };
      resolved = next;
      continue;
    }
    // `resolved` is where this link really lives.
    if (turnCanWrite(resolved)) return { issue: 'agent-link' };
    const link = ++links > 40 ? undefined : await readlink(next).catch(() => undefined);
    if (link === undefined) return { issue: 'unreadable' };
    if (path.isAbsolute(link)) resolved = root;
    pending.unshift(...parts(link));
  }
  // The innermost provider folder that holds the path decides: one may be nested in the other, and
  // both providers may share one.
  const holders = (await providerFolders()).filter(({ folder }) => within(folder, resolved));
  const innermost = holders.filter(({ folder }) => folder.length === Math.max(...holders.map((holder) => holder.folder.length)));
  const allowlisted = innermost.some(({ provider, folder }) => (
    PROVIDER_CUSTOMIZATIONS[provider].some(({ name }) => name === parts(resolved)[parts(folder).length])
  ));
  return holders.length && !allowlisted ? { issue: 'protected' } : { realPath: resolved };
}

export type GlobalInstructionFile = {
  /** Relative to the home directory; a symbolic link shows its target after an arrow. */
  displayPath: string;
  /** The entry's own name, for a line that must not carry a path. */
  name: string;
  /** The file the path resolves to, when it may be read. */
  realPath?: string;
  /** The file lies where an agent turn can write, so a turn there can change what it says. */
  agentEditable?: true;
} & ({ text: string } | { issue: InstructionFileIssue });

async function readInstructionFile(directory: string, name: string, config: AgentRoots, retried = false): Promise<GlobalInstructionFile> {
  const homes = [os.homedir(), await canonical(os.homedir())];
  const fromHome = (file: string) => {
    const home = homes.find((candidate) => file === candidate || file.startsWith(`${candidate}${path.sep}`));
    return home ? `~${file.slice(home.length)}` : file;
  };
  const file = path.join(directory, name);
  const resolved = await resolveUserPath(file, config);
  if ('issue' in resolved) return { displayPath: fromHome(file), name, issue: resolved.issue };
  const { realPath } = resolved;
  // An arrow only for the entry's own link: a linked home or provider folder is where the file is.
  const linked = realPath !== path.join(await canonical(directory), name);
  const agentEditable = (await agentWritable(config))(realPath);
  const described = {
    displayPath: linked ? `${fromHome(file)} → ${fromHome(realPath)}` : fromHome(file), name, realPath,
    ...(agentEditable ? { agentEditable } : {}),
  };
  // Where a turn can write, it could swap a folder on the way for a link between the walk above and
  // the read. The read proves which file it opened; where the system cannot, the file is not read.
  // Nothing on a path no turn can write can be swapped, so such a file needs no proof.
  if (agentEditable && !namesOpenFiles()) return { ...described, issue: 'unverified' };
  const read = await readBoundedTextFile(realPath, GLOBAL_INSTRUCTIONS_BYTES, { exactly: agentEditable });
  if ('text' in read) return { ...described, text: read.text };
  if (read.issue !== 'changed') return { ...described, issue: read.issue };
  // An editor that saves by replacing the file looks the same once; a turn that keeps swapping it does not.
  return retried ? { ...described, issue: 'agent-link' } : readInstructionFile(directory, name, config, true);
}

const SKIPPED_BY_CODEX: readonly InstructionFileIssue[] = ['missing', 'not-file', 'unreadable'];

/**
 * The global instruction file the provider itself reads, whole or with the reason it is not passed.
 * Codex skips a candidate it cannot read or that holds no text; one CodeAI cannot pass stays the
 * answer, so a different file is never passed in its place.
 */
export async function resolveGlobalInstructionFile(provider: AgentProvider, config: AgentRoots): Promise<GlobalInstructionFile> {
  const directory = providerFolder(provider);
  const skipped: GlobalInstructionFile[] = [];
  for (const name of INSTRUCTION_FILES[provider]) {
    const file = await readInstructionFile(directory, name, config);
    if ('issue' in file ? !SKIPPED_BY_CODEX.includes(file.issue) : file.text.trim()) return file;
    skipped.push(file);
  }
  // Nothing to pass: say so about the file that is there, else about the last name looked for.
  return skipped.find((file) => !('issue' in file) || file.issue !== 'missing') ?? skipped.at(-1)!;
}

/** Whether a resolved file has text to pass. An empty file says nothing, so nothing is framed. */
function passable(file: GlobalInstructionFile): file is GlobalInstructionFile & { text: string } {
  return 'text' in file && Boolean(file.text.trim());
}

/**
 * CLAUDE.md's `@path` imports, which Claude does not read inside code. They are passed as written:
 * CodeAI reads one file, never what it names.
 */
export function hasInstructionImports(text: string): boolean {
  return /(?:^|\s)@[^\s@]+/.test(text.replaceAll(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, ' '));
}

export function instructionSettingsPath(dataDir: string): string {
  return path.join(dataDir, 'instructions', 'settings.json');
}

export interface InstructionSettings {
  claude: boolean;
  codex: boolean;
  /** The record exists but cannot be used, so both providers read as off until one switch is saved. */
  damaged?: true;
}

/** Read for each turn, so a switch applies without a restart. No record means both are on. */
export async function readInstructionSettings(dataDir: string): Promise<InstructionSettings> {
  try {
    return instructionSettingsSchema.parse(JSON.parse(await readFile(instructionSettingsPath(dataDir), 'utf8')));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { claude: true, codex: true }
      : { claude: false, codex: false, damaged: true };
  }
}

/**
 * What one turn gets: the session's own choice before this machine's switch. Local Codex loads its
 * own global file, so it never gets the text a second time.
 */
export async function turnGlobalInstructions(config: Pick<AppConfig, 'dataDir' | 'repositoriesRoot'>, turn: {
  provider: AgentProvider;
  execution: AgentExecution;
  choice?: GlobalInstructionsChoice;
}): Promise<{ globalInstructions?: GlobalInstructions; userCustomizations: boolean }> {
  const choice = effectiveInstructions({ ...turn, machine: await readInstructionSettings(config.dataDir) });
  if (choice !== 'global' || (turn.provider === 'codex' && turn.execution === 'local')) return { userCustomizations: false };
  const file = await resolveGlobalInstructionFile(turn.provider, config);
  return {
    userCustomizations: turn.execution === 'docker',
    ...(passable(file) ? { globalInstructions: { displayPath: file.displayPath, text: file.text } } : {}),
  };
}

/**
 * The words a provider gets around the user's text. CodeAI's own contract stays above it. In Docker
 * the sentence about `customizationsPath` also stands alone, for a worker with entries but no file.
 */
export function frameGlobalInstructions(file: GlobalInstructions | undefined, customizationsPath?: string): string | undefined {
  const customizations = customizationsPath
    ? `The user's customizations are available read-only at \`${customizationsPath}\`.`
    : undefined;
  if (!file) return customizations;
  const head = `The user's global instructions from \`${file.displayPath}\` follow. Where they conflict with CodeAI's instructions, CodeAI's instructions apply.`;
  return `${[head, customizations].filter(Boolean).join(' ')}\n\n${file.text}`;
}

/**
 * For the health response: this machine's switches, whether each provider has a file to use, and a
 * readiness line for each provider whose instructions are switched on but cannot be passed. Having
 * no file is not worth a line.
 */
export async function instructionsReadiness(config: Pick<AppConfig, 'dataDir' | 'repositoriesRoot'>): Promise<{
  instructions: MachineInstructions;
  notes: Partial<Record<AgentProvider, string>>;
}> {
  const { damaged, ...settings } = await readInstructionSettings(config.dataDir);
  const files = { claude: await resolveGlobalInstructionFile('claude', config), codex: await resolveGlobalInstructionFile('codex', config) };
  const instructions = Object.fromEntries(PROVIDERS.map((provider) => {
    const file = files[provider];
    // Local Codex reads its file itself, whatever CodeAI could pass: all it needs is a file with text.
    const present = 'issue' in file ? !SKIPPED_BY_CODEX.includes(file.issue) : passable(file);
    return [provider, { enabled: settings[provider], passable: passable(file), present }];
  })) as MachineInstructions;
  if (damaged) {
    const note = 'The global instructions setting on this machine is damaged, so agents run without your global instructions. Set a switch under Global instructions in the Arena to repair it.';
    return { instructions, notes: { claude: note, codex: note } };
  }
  const notes: Partial<Record<AgentProvider, string>> = {};
  for (const provider of PROVIDERS) {
    const file = files[provider];
    if (settings[provider] && 'issue' in file && file.issue !== 'missing') {
      // Health reaches an attached home machine, so the line names the file and never where it leads.
      notes[provider] = `${provider === 'codex' ? 'Docker Codex' : PROVIDER_LABELS[provider]} runs without your global instructions: ${file.name} ${INSTRUCTION_ISSUE_TEXT[file.issue]}.`;
    }
  }
  return { instructions, notes };
}
