import { describe, expect, it, vi } from 'vitest';
import { captureDescendantProcesses } from '@/server/agents/processDescendants';

const fs = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn() }));
vi.mock('node:fs/promises', () => fs);

describe.skipIf(process.platform !== 'linux')('incomplete provider process inventory', () => {
  it('preserves verified identities and stops verifying new children at the bound', async () => {
    const root = { pid: 900000, started: 'root-start' };
    const children = Array.from({ length: 1025 }, (_, index) => root.pid + index + 1);
    const verified = new Set<number>();
    fs.readdir.mockResolvedValue(['task']);
    fs.readFile.mockImplementation(async (filename: string) => {
      if (filename.endsWith('/children')) return children.join(' ');
      const pid = Number(filename.split('/')[2]);
      const fields = Array.from({ length: 20 }, () => '0');
      fields[0] = 'R'; fields[1] = String(pid === root.pid ? 1 : root.pid);
      fields[19] = pid === root.pid ? root.started : `child-${pid}`;
      if (pid !== root.pid) verified.add(pid);
      return `${pid} (fixture) ${fields.join(' ')}`;
    });
    const error = await captureDescendantProcesses(root).catch(error => error);
    expect(error).toMatchObject({ observed: expect.any(Array) });
    expect(error.observed).toHaveLength(1023);
    expect(new Set(error.observed.map((process: { pid: number }) => process.pid))).toEqual(verified);
    expect(verified.size).toBe(1023);
  });
});
