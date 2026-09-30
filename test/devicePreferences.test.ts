import { describe, expect, it } from 'vitest';
import { agentModelSelection, inheritedMode, launchChoice, launchModes, parseDevicePreferences } from '@/features/shell/devicePreferences';
import type { AgentMode } from '@/shared/types';
import { emptyDeviceView } from '@/features/shell/workspaceViews';

const AGENT_A = '12121212-1212-4121-8121-121212121212';
const AGENT_B = '34343434-3434-4343-8343-343434343434';

describe('device preferences', () => {
  it('keeps the last mode, provider, and each provider\'s model choice, and nothing else', () => {
    expect(parseDevicePreferences(JSON.stringify({
      version: 1,
      mode: 'agent',
      provider: 'codex',
      models: { claude: { model: 'opus', effort: 'high' }, codex: {} },
    }))).toEqual({
      mode: 'agent',
      provider: 'codex',
      models: { claude: { model: 'opus', effort: 'high' }, codex: {} },
    });

    expect(parseDevicePreferences(JSON.stringify({
      version: 1,
      mode: 'yolo',
      provider: 'gemini',
      execution: 'docker',
      models: {
        claude: { model: '--dangerously-skip-permissions', effort: 'max', flags: ['--yolo'] },
        codex: 'gpt-5.5',
        gemini: { model: 'pro' },
      },
    }))).toEqual({ models: { claude: { effort: 'max' } } });
    expect(parseDevicePreferences(JSON.stringify({ version: 1, models: [] }))).toEqual({});

    for (const malformed of [null, '', '{', '[]', '"agent"', JSON.stringify({ version: 2, mode: 'agent' })]) {
      expect(parseDevicePreferences(malformed)).toEqual({});
    }
  });

  it('prefers an agent\'s own choice, else its provider\'s last choice', () => {
    const preferences = { models: { claude: { model: 'opus', effort: 'high' } } };
    const view = { ...emptyDeviceView(), modelSelections: { [AGENT_A]: { model: 'sonnet' }, [AGENT_B]: {} } };
    const agent = (id: string, provider: 'claude' | 'codex' = 'claude') => ({ id, provider });

    expect(agentModelSelection(view, preferences, agent(AGENT_A))).toEqual({ model: 'sonnet' });
    // Default chosen for this agent stays Default, whatever was chosen for another agent later.
    expect(agentModelSelection(view, preferences, agent(AGENT_B))).toEqual({});
    expect(agentModelSelection(emptyDeviceView(), preferences, agent(AGENT_A))).toEqual({ model: 'opus', effort: 'high' });
    expect(agentModelSelection(undefined, preferences, agent(AGENT_A))).toEqual({ model: 'opus', effort: 'high' });
    expect(agentModelSelection(undefined, preferences, agent(AGENT_A, 'codex'))).toBeUndefined();
    expect(agentModelSelection(view, {}, undefined)).toBeUndefined();
  });

  it('starts a session without its own mode at the last mode, but never a Docker session in Agent', () => {
    expect(inheritedMode('plan', 'local')).toBe('plan');
    expect(inheritedMode('agent', 'local')).toBe('agent');
    expect(inheritedMode('agent', undefined)).toBe('agent');
    expect(inheritedMode('plan', 'docker')).toBe('plan');
    // Docker Agent edits without individual approvals, so it has to be chosen for that session.
    expect(inheritedMode('agent', 'docker')).toBe('ask');
    expect(inheritedMode(undefined, 'local')).toBe('ask');
  });

  it('remembers Auto as the last mode but never starts another session in it', () => {
    expect(parseDevicePreferences(JSON.stringify({ version: 1, mode: 'auto', provider: 'codex' }))).toEqual({ mode: 'auto', provider: 'codex' });
    for (const execution of ['local', 'docker', undefined] as const) expect(inheritedMode('auto', execution)).toBe('ask');

    const health = (modes: AgentMode[]) => ({ available: true, supportedModes: modes });
    const machine = { claude: health(['ask', 'plan', 'agent']), codex: health(['ask', 'plan', 'agent', 'auto']) };
    // Ask, not the mode the form happened to show, and not Auto even where the provider offers it.
    expect(launchChoice({ provider: 'codex', mode: 'auto' }, machine, { provider: 'claude', mode: 'agent' })).toEqual({ provider: 'codex', mode: 'ask' });
    expect(launchChoice({ mode: 'auto' }, machine, { provider: 'codex', mode: 'plan' })).toEqual({ provider: 'codex', mode: 'ask' });
    // A machine that lists Auto first still opens the form at a mode a new session may use.
    expect(launchChoice({ provider: 'codex' }, { codex: health(['auto', 'plan']) }, { provider: 'codex', mode: 'agent' })).toEqual({ provider: 'codex', mode: 'plan' });
    expect(launchModes(['ask', 'plan', 'agent', 'auto'])).toEqual(['ask', 'plan', 'agent']);
    expect(launchModes(undefined)).toEqual([]);
  });

  it('opens a New session form at the last provider and mode only when the machine can run them', () => {
    const health = (modes: ('ask' | 'plan' | 'agent')[], available = true) => ({ available, supportedModes: modes });
    const current = { provider: 'claude', mode: 'ask' } as const;
    const machine = { claude: health(['ask', 'plan', 'agent']), codex: health(['ask', 'plan']) };

    expect(launchChoice({ provider: 'codex', mode: 'plan' }, machine, current)).toEqual({ provider: 'codex', mode: 'plan' });
    expect(launchChoice({ mode: 'agent' }, machine, current)).toEqual({ provider: 'claude', mode: 'agent' });
    // Codex cannot run Agent here, so the mode stays where the form was.
    expect(launchChoice({ provider: 'codex', mode: 'agent' }, machine, current)).toEqual({ provider: 'codex', mode: 'ask' });
    expect(launchChoice({ provider: 'codex', mode: 'plan' }, { ...machine, codex: health(['ask'], false) }, current))
      .toEqual({ provider: 'claude', mode: 'plan' });
    expect(launchChoice({ provider: 'codex', mode: 'plan' }, { ...machine, codex: health([]) }, current))
      .toEqual({ provider: 'claude', mode: 'plan' });
    // A form left in a mode the preferred provider cannot run opens at that provider's first mode.
    expect(launchChoice({ provider: 'codex' }, machine, { provider: 'claude', mode: 'agent' })).toEqual({ provider: 'codex', mode: 'ask' });
    expect(launchChoice({}, machine, current)).toEqual(current);
    expect(launchChoice({ provider: 'codex', mode: 'plan' }, undefined, current)).toEqual(current);
  });
});
