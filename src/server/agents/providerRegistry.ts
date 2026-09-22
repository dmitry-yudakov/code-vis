import type {
  AgentExecution, AgentProvider, AgentProviderAdapter, AgentProcessRunner, ProviderHealth,
} from '@/shared/types';
import type { AppConfig } from '@/server/config';
import { ClaudeProcessRunner } from './claudeProcessRunner';
import { checkClaude } from './claudePreflight';
import { claudeModelChoices } from './claudeInvocation';
import { CodexProcessRunner } from './codexProcessRunner';
import { checkCodex } from './codexPreflight';
import { codexSupportedModes } from './codexInvocation';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { DockerProcessRunner } from '@/server/execution/dockerProcessRunner';

class ClaudeProviderAdapter implements AgentProviderAdapter {
  readonly id = 'claude' as const;
  readonly supportedModes = ['ask', 'plan', 'agent'] as const;

  constructor(private readonly config: AppConfig) {}

  async checkHealth(): Promise<ProviderHealth> {
    const result = await checkClaude(this.config.claudeBin);
    const supportedModes = this.supportedModes.filter((mode) => !result.unsupportedModes.includes(mode));
    return {
      available: result.binaryReady && supportedModes.length > 0,
      authenticated: 'unknown',
      supportedModes: [...supportedModes],
      message: result.message,
      ...claudeModelChoices(result.effortSupported, this.config.claudeModel),
    };
  }

  createRunner(): AgentProcessRunner {
    return new ClaudeProcessRunner({
      binary: this.config.claudeBin,
      model: this.config.claudeModel,
      maxOutputBytes: this.config.maxAssistantBytes,
      debug: this.config.debugAgent,
    });
  }
}

class CodexProviderAdapter implements AgentProviderAdapter {
  readonly id = 'codex' as const;
  readonly supportedModes;

  constructor(private readonly config: AppConfig) {
    this.supportedModes = codexSupportedModes(config.codexAgentEnabled);
  }

  checkHealth(): Promise<ProviderHealth> {
    return checkCodex(this.config.codexBin, this.config.repositoriesRoot, this.config.codexAgentEnabled);
  }

  createRunner(): AgentProcessRunner {
    return new CodexProcessRunner({
      binary: this.config.codexBin,
      model: this.config.codexModel,
      maxOutputBytes: this.config.maxAssistantBytes,
      debug: this.config.debugAgent,
    });
  }
}

export type ProviderRegistry = Record<AgentProvider, AgentProviderAdapter>;

const LOCAL_HEALTH_TTL_MS = 10_000;
let cachedLocalHealth: { key: string; checkedAt: number; providers: Record<AgentProvider, ProviderHealth> } | undefined;
let localHealthPromise: Promise<Record<AgentProvider, ProviderHealth>> | undefined;

/** This machine's Local provider health, reused for 10 s by executor snapshots and Docker turns. */
export async function cachedLocalProviderHealth(config: AppConfig): Promise<Record<AgentProvider, ProviderHealth>> {
  const key = `${config.claudeBin}\0${config.claudeModel || ''}\0${config.codexBin}\0${config.codexModel || ''}\0${config.codexAgentEnabled}`;
  if (cachedLocalHealth?.key === key && Date.now() - cachedLocalHealth.checkedAt < LOCAL_HEALTH_TTL_MS) {
    return structuredClone(cachedLocalHealth.providers);
  }
  if (!localHealthPromise) {
    const adapters = getProviderAdapters(config);
    localHealthPromise = Promise.all([adapters.claude.checkHealth(), adapters.codex.checkHealth()])
      .then(([claude, codex]) => {
        const providers = { claude, codex };
        cachedLocalHealth = { key, checkedAt: Date.now(), providers };
        return providers;
      })
      .finally(() => { localHealthPromise = undefined; });
  }
  return structuredClone(await localHealthPromise);
}

/**
 * Docker health checks the engine, not the providers. Docker Claude offers the fixed choices, because
 * the pinned worker documents `--effort`; Docker Codex offers what this machine's Codex lists.
 */
export function dockerProviderHealth(
  config: AppConfig, engine: ProviderHealth, localCodex?: ProviderHealth,
): Record<AgentProvider, ProviderHealth> {
  return {
    claude: { ...engine, ...claudeModelChoices(true, config.claudeModel) },
    codex: {
      ...engine,
      ...(localCodex?.models ? { models: localCodex.models } : {}),
      ...(localCodex?.efforts ? { efforts: localCodex.efforts } : {}),
    },
  };
}

export function getProviderAdapters(config: AppConfig, execution: AgentExecution = 'local',
  identity?: { sessionId: string; participantId: string }): ProviderRegistry {
  if (execution === 'docker') {
    const adapter = (id: AgentProvider): AgentProviderAdapter => ({
      id, supportedModes: ['ask', 'plan', 'agent'],
      async checkHealth() {
        const [engine, local] = await Promise.all([
          getDockerRuntime(config).health(),
          id === 'codex' ? cachedLocalProviderHealth(config) : undefined,
        ]);
        return dockerProviderHealth(config, engine, local?.codex)[id];
      },
      createRunner() {
        if (!identity) throw new Error('Docker execution requires an addressed session participant.');
        return new DockerProcessRunner(config, id, identity);
      },
    });
    return { claude: adapter('claude'), codex: adapter('codex') };
  }
  return {
    claude: new ClaudeProviderAdapter(config),
    codex: new CodexProviderAdapter(config),
  };
}
