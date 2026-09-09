import { readdir, realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentProcessRun, AgentProcessRunner, AgentProvider } from '@/shared/types';
import type { AppConfig } from '@/server/config';
import { ClaudeProcessRunner } from '@/server/agents/claudeProcessRunner';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { AgentRunError } from '@/server/agents/agentRunError';
import { getDockerRuntime, DockerTerminationError } from './dockerRuntime';

export class DockerProcessRunner implements AgentProcessRunner {
  constructor(private readonly config: AppConfig, private readonly provider: AgentProvider,
    private readonly identity: { sessionId: string; participantId: string }) {}

  async run(input: AgentProcessRun) {
    const runtime = getDockerRuntime(this.config);
    let stop: (() => Promise<void>) | undefined;
    const finishStopping = async (cleanup: () => Promise<void>) => {
      let reported = false;
      for (;;) {
        try { await cleanup(); return; }
        catch {
          if (!reported) {
            input.emit({ type: 'activity', tool: 'Stopping Docker', detail: 'Termination is unconfirmed. The checkout and machine slot remain locked until Docker recovers.' });
            reported = true;
          }
          await delay(5_000);
        }
      }
    };
    try {
      if (input.signal.aborted) throw new AgentRunError('cancelled', 'The request was cancelled.', 'not-sent');
      const context = await realpath(input.attachmentDirectory);
      const worker = await runtime.createWorker({ ...this.identity, provider: this.provider, runId: input.runId }, {
        checkout: input.checkout.realPath, context, mode: input.policy.mode,
      });
      stop = worker.stop;
      try { await worker.authenticate(); }
      catch (error) { throw new AgentRunError('unauthenticated', (error as Error).message, 'not-sent'); }
      if (input.signal.aborted) throw new AgentRunError('cancelled', 'The request was cancelled.', 'not-sent');
      const translated = {
        ...input,
        checkout: { ...input.checkout, realPath: '/workspace' }, attachmentDirectory: '/context',
        prompt: input.prompt.replaceAll(input.attachmentDirectory, '/context').replaceAll(input.checkout.realPath, '/workspace'),
      };
      const common = { transport: worker, maxOutputBytes: this.config.maxAssistantBytes, debug: false };
      const runner = this.provider === 'claude'
        ? new ClaudeProcessRunner({ ...common, binary: '/usr/local/bin/claude', model: this.config.claudeModel })
        : new CodexProcessRunner({ ...common, binary: '/usr/local/bin/codex', model: this.config.codexModel,
          imagePaths: (await readdir(context)).filter((name) => name.endsWith('.png')).map((name) => `/context/${name}`) });
      return await runner.run(translated);
    } catch (error) {
      if (error instanceof DockerTerminationError) await finishStopping(error.stop);
      throw error;
    } finally {
      // A protocol result is not container termination. No completion/lock release precedes this.
      if (stop) await finishStopping(stop);
    }
  }
}
