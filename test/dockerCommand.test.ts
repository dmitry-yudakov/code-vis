import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: vi.fn() }));

import { removeContainerDetached } from '@/server/execution/dockerCommand';

describe('detached Docker removal', () => {
  it('starts a forced removal in its own session and never waits for or fails on it', () => {
    const child = { on: vi.fn(() => child), unref: vi.fn() };
    mocks.spawn.mockReturnValueOnce(child);
    removeContainerDetached('unix:///fixture/docker.sock', 'worker-id');
    expect(mocks.spawn).toHaveBeenCalledWith('docker',
      ['--host', 'unix:///fixture/docker.sock', 'container', 'rm', '--force', 'worker-id'],
      expect.objectContaining({ detached: true, stdio: 'ignore', shell: false }));
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(child.unref).toHaveBeenCalledOnce();
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    expect(() => removeContainerDetached('unix:///fixture/docker.sock', 'worker-id')).not.toThrow();
  });
});
