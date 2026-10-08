import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync,
  renameSync, unlinkSync, writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';

export interface ServerLogConfig {
  directory: string;
  maxBytes: number;
  /** Includes the current file. */
  maxFiles: number;
}

export function serverLogConfig(environment: Readonly<Record<string, string | undefined>>, root: string): ServerLogConfig | undefined {
  const setting = (suffix: string) => environment[`CODEAI_${suffix}`] || environment[`CODEAI_WEB2_${suffix}`];
  const directory = setting('LOG_DIR');
  if (!directory) return undefined;
  const integer = (suffix: string, fallback: number, min: number, max: number) => {
    const raw = setting(suffix);
    const value = raw ? Number(raw) : fallback;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`CODEAI_${suffix} must be an integer between ${min} and ${max}`);
    }
    return value;
  };
  const expanded = directory === '~' ? os.homedir()
    : directory.startsWith('~/') ? path.join(os.homedir(), directory.slice(2)) : directory;
  return {
    directory: path.resolve(root, expanded),
    maxBytes: integer('LOG_MAX_BYTES', 10 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    maxFiles: integer('LOG_MAX_FILES', 5, 1, 100),
  };
}

type OutputStream = 'stdout' | 'stderr';

function createLogDirectory(directory: string): void {
  // Check each component before creating the next, so a planted parent link cannot redirect mkdir.
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!lstatSync(current).isDirectory()) throw new Error('The log directory path must contain only real directories');
  }
}

/** One launcher owns the directory, including all inherited child output. No server-thread I/O. */
export class RotatingServerLog {
  private descriptor: number | undefined;
  private size = 0;
  private failed = false;
  private readonly streams = {
    stdout: { decoder: new StringDecoder('utf8'), pending: '' },
    stderr: { decoder: new StringDecoder('utf8'), pending: '' },
  };
  private readonly file: string;
  private readonly payloadBytes: number;

  constructor(private readonly config: ServerLogConfig, private readonly warn: (message: string) => void) {
    this.file = path.join(config.directory, 'server.log');
    this.payloadBytes = Math.min(64 * 1024, config.maxBytes - 64);
    this.attempt(() => {
      createLogDirectory(config.directory);
      this.prune();
      this.open();
      if (this.size >= config.maxBytes) this.rotate();
    });
  }

  write(stream: OutputStream, chunk: Buffer): void {
    if (this.failed) return;
    this.streams[stream].pending += this.streams[stream].decoder.write(chunk);
    this.attempt(() => this.drain(stream));
  }

  close(): void {
    this.attempt(() => {
      for (const stream of ['stdout', 'stderr'] as const) {
        this.streams[stream].pending += this.streams[stream].decoder.end();
        this.drain(stream);
        if (this.streams[stream].pending) this.record(stream, this.streams[stream].pending);
        this.streams[stream].pending = '';
      }
      this.closeFile();
    });
  }

  private drain(stream: OutputStream): void {
    const state = this.streams[stream];
    while (state.pending) {
      const newline = state.pending.indexOf('\n');
      if (newline >= 0 && Buffer.byteLength(state.pending.slice(0, newline)) <= this.payloadBytes) {
        this.record(stream, state.pending.slice(0, newline).replace(/\r$/, ''));
        state.pending = state.pending.slice(newline + 1);
      } else {
        const bytes = Buffer.from(state.pending);
        if (bytes.length <= this.payloadBytes) return;
        // Split long lines only between UTF-8 code points, retaining every character.
        let end = this.payloadBytes;
        while ((bytes[end] & 0xc0) === 0x80) end--;
        this.record(stream, bytes.subarray(0, end).toString('utf8'));
        state.pending = bytes.subarray(end).toString('utf8');
      }
    }
  }

  private record(stream: OutputStream, line: string): void {
    const bytes = Buffer.from(`[${new Date().toISOString()}] [${stream}] ${stripVTControlCharacters(line)}\n`);
    if (this.size + bytes.length > this.config.maxBytes) this.rotate();
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(this.descriptor!, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error('The log write made no progress');
      offset += written;
      this.size += written;
    }
  }

  private open(): void {
    createLogDirectory(this.config.directory);
    this.descriptor = openSync(this.file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
      | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const info = fstatSync(this.descriptor);
    if (!info.isFile() || info.nlink !== 1) throw new Error('The log file must be a regular file with one link');
    this.size = info.size;
  }

  private closeFile(): void {
    const descriptor = this.descriptor;
    this.descriptor = undefined;
    if (descriptor !== undefined) closeSync(descriptor);
  }

  private prune(): void {
    for (const name of readdirSync(this.config.directory)) {
      const index = /^server\.log\.(\d+)$/.exec(name)?.[1];
      if (index && Number(index) >= this.config.maxFiles) unlinkSync(path.join(this.config.directory, name));
    }
  }

  private rotate(): void {
    createLogDirectory(this.config.directory);
    this.closeFile();
    // Remove/rename exact owned filenames only; unlink and rename never follow an archive link.
    const remove = (file: string) => {
      try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    };
    if (this.config.maxFiles === 1) remove(this.file);
    else {
      remove(`${this.file}.${this.config.maxFiles - 1}`);
      for (let index = this.config.maxFiles - 2; index >= 0; index--) {
        try { renameSync(index ? `${this.file}.${index}` : this.file, `${this.file}.${index + 1}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    this.open();
  }

  private attempt(operation: () => void): void {
    if (this.failed) return;
    try { operation(); }
    catch (error) {
      this.failed = true;
      try { this.closeFile(); } catch { /* The console remains available even after a disk failure. */ }
      this.streams.stdout.pending = this.streams.stderr.pending = '';
      this.warn(`CodeAI file logging disabled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
