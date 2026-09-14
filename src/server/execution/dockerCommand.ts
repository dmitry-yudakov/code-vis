import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import { DOCKER_PATH } from './dockerProfile';

/** Only Docker's own local configuration is inherited; no provider variables reach a worker. */
export function dockerEnvironment(): NodeJS.ProcessEnv {
  return { PATH: `${DOCKER_PATH}:/opt/homebrew/bin`, HOME: os.homedir(), LANG: 'C.UTF-8', NODE_ENV: 'production' };
}

export class DockerCommandError extends Error {
  constructor(readonly exitCode: number | string | undefined, operation: string) {
    super(`The local Docker ${operation} operation failed. Check Docker and the CodeAI Docker setup guide.`);
    this.name = 'DockerCommandError';
  }
}

export function dockerCommand(args: string[], options: { timeout?: number; maxBuffer?: number } = {}): Promise<string> {
  const commandIndex = args[0] === '--host' ? 2 : 0;
  const operation = args.slice(commandIndex, commandIndex + (['container', 'volume', 'image', 'network', 'context'].includes(args[commandIndex]) ? 2 : 1)).join(' ');
  return new Promise((resolve, reject) => {
    execFile('docker', args, {
      env: dockerEnvironment(), cwd: os.tmpdir(), encoding: 'utf8',
      timeout: options.timeout ?? 60_000, maxBuffer: options.maxBuffer ?? 1_048_576,
    }, (error, stdout) => {
      // Never forward Docker/CLI output on a failure: setup/auth commands can print secrets.
      if (error) reject(new DockerCommandError(error.code ?? undefined, operation));
      else resolve(stdout);
    });
  });
}

export async function localDockerEndpoint(): Promise<string> {
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix:///')) {
    throw new Error('CodeAI supports only a local Docker daemon over a Unix socket.');
  }
  const context = process.env.DOCKER_CONTEXT;
  if (context && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(context)) throw new Error('Invalid Docker context name.');
  const endpoint = !context && process.env.DOCKER_HOST
    ? process.env.DOCKER_HOST
    : (await dockerCommand(['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).trim();
  if (!/^unix:\/\/\/[^\r\n\0]+$/.test(endpoint)) throw new Error('Remote Docker contexts are unsupported. Select a local Docker context.');
  return endpoint;
}

export function spawnDocker(endpoint: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn('docker', ['--host', endpoint, ...args], {
    cwd: os.tmpdir(), env: dockerEnvironment(), shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
}
