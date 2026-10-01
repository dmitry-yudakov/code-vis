'use client';

import { useCallback, useEffect, useState } from 'react';
import { INSTRUCTION_ISSUE_TEXT } from '@/shared/globalInstructions';
import { PROVIDER_LABELS } from '@/shared/participants';
import type { AgentProvider, GlobalInstructionsView as InstructionsView, ProviderInstructions, SecurityLevel } from '@/shared/types';

const PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];

/** The file as it is passed: whole, read-only, and closed until asked for. */
function InstructionText({ text }: { text: string }) {
  return (
    <details className="arena-instructions-file">
      <summary>Show file</summary>
      <pre tabIndex={0}>{text}</pre>
    </details>
  );
}

function dockerLine(provider: AgentProvider, docker: ProviderInstructions['docker']): string | undefined {
  if (!docker.entries.length && !docker.skipped.length) return undefined;
  return [
    docker.entries.length ? `A Docker turn that uses them sees ${docker.entries.join(', ')} read-only at /user/${provider}.` : undefined,
    docker.skipped.length ? `Left out: ${docker.skipped.join('; ')}.` : undefined,
  ].filter(Boolean).join(' ');
}

export function GlobalInstructionsView({ view, error, saving, dockerEnabled, securityLevel = 'guarded', onSwitch }: {
  view?: InstructionsView;
  error?: string;
  saving?: boolean;
  /** Docker is enabled on this machine, so what a worker sees is worth a line. */
  dockerEnabled?: boolean;
  securityLevel?: SecurityLevel;
  onSwitch(provider: AgentProvider, enabled: boolean): void;
}) {
  return (
    <section className="arena-instructions" aria-label="Global instructions">
      <div className="arena-instructions-heading">
        <strong>Global instructions</strong>
        <span>Takes effect on the next Docker Codex turn and in a Claude agent’s next provider session.</span>
      </div>
      {securityLevel === 'native' && <p>Local Claude loads its own global instructions in Native writing modes. Its switch applies to Ask, Plan, and Docker.</p>}
      {view?.damaged && <p role="status">This machine’s setting is damaged, so Claude and Docker Codex run without them. Set either switch to repair it.</p>}
      {view && PROVIDERS.map((provider) => {
        const instructions = view.providers[provider];
        const docker = dockerEnabled ? dockerLine(provider, instructions.docker) : undefined;
        return (
          <div className="arena-instruction" key={provider}>
            <label>
              <input type="checkbox" checked={instructions.enabled} disabled={saving}
                aria-label={`Use global instructions for ${PROVIDER_LABELS[provider]}`}
                onChange={(event) => onSwitch(provider, event.target.checked)} />
              {PROVIDER_LABELS[provider]}
            </label>
            <code>{instructions.displayPath}</code>
            {instructions.issue && (
              <span role="status">
                {instructions.issue === 'missing' ? 'No file yet.' : `Not passed: it ${INSTRUCTION_ISSUE_TEXT[instructions.issue]}.`}
              </span>
            )}
            {instructions.localAlways && <p>Local Codex always uses this file. The switch applies to Docker Codex.</p>}
            {instructions.imports && <p>Its @ imports are passed as written, not followed.</p>}
            {instructions.agentEditable && <p>This file is under the repositories root: a turn that edits its folder can change what these instructions say.</p>}
            {docker && <p>{docker}</p>}
            {!view.shared && instructions.text !== undefined && <InstructionText text={instructions.text} />}
          </div>
        );
      })}
      {view?.shared && (
        <div className="arena-instruction">
          <p>Claude and Codex share this file.</p>
          {view.providers.claude.text !== undefined && <InstructionText text={view.providers.claude.text} />}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/**
 * This machine's global instructions: one switch per provider and the file each one reads. The
 * server resolves every path and text; this view names only a provider and its switch.
 */
export function GlobalInstructions({ dockerEnabled, securityLevel = 'guarded', refreshing, onChanged }: {
  dockerEnabled?: boolean;
  securityLevel?: SecurityLevel;
  /** The Arena is refreshing: the files may have changed too, so they are read again once it is done. */
  refreshing: boolean;
  onChanged(): void;
}) {
  const [view, setView] = useState<InstructionsView>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const request = useCallback(async (init?: RequestInit) => {
    try {
      const response = await fetch('/api/instructions', { cache: 'no-store', ...init });
      const data = await response.json().catch(() => ({})) as InstructionsView & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not read the global instructions.');
      setView(data);
      setError(undefined);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read the global instructions.');
      return false;
    }
  }, []);

  useEffect(() => { if (!refreshing) void request(); }, [refreshing, request]);

  const onSwitch = (provider: AgentProvider, enabled: boolean) => {
    setSaving(true);
    void request({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, enabled }),
    }).then((saved) => { if (saved) onChanged(); }).finally(() => setSaving(false));
  };

  return <GlobalInstructionsView view={view} error={error} saving={saving} dockerEnabled={dockerEnabled} securityLevel={securityLevel} onSwitch={onSwitch} />;
}
