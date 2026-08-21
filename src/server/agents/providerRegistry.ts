import type {
  AgentProvider, AgentProviderAdapter, AgentProcessRunner, ProviderHealth,
} from '@/shared/types';
import type { AppConfig } from '@/server/config';
import { ClaudeProcessRunner } from './claudeProcessRunner';
import { checkClaude } from './claudePreflight';
import { CodexProcessRunner } from './codexProcessRunner';
import { checkCodex } from './codexPreflight';
import { codexSupportedModes } from './codexInvocation';

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
    return checkCodex(this.config.codexBin, this.config.projectsRoot, this.config.codexAgentEnabled);
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

export function getProviderAdapters(config: AppConfig): ProviderRegistry {
  return {
    claude: new ClaudeProviderAdapter(config),
    codex: new CodexProviderAdapter(config),
  };
}
