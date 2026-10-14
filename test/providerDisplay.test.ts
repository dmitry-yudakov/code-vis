import { describe, expect, it } from 'vitest';
import { claudeDisplayInput, displayIdentity, displayResult } from '@/server/agents/providerDisplay';

describe('provider display projection', () => {
  it('keeps review independent from the shorter multibyte display field budget', () => {
    const projected = claudeDisplayInput('Bash', { command: `echo ${'界'.repeat(6000)}` }, '/repo', '/attachments');
    expect(Buffer.byteLength(projected.text)).toBeLessThanOrEqual(16 * 1024);
    expect(projected.omittedBytes).toBeGreaterThan(0);
    expect(projected.review.completeness).toBe('complete');
    expect(projected.review.text).toContain('界'.repeat(6000));
    expect(claudeDisplayInput('Bash', { command: 'x'.repeat(65536) }, '/repo', '/attachments').review).toMatchObject({ completeness: 'unavailable' });
  });

  it('preserves exact review paths even when display history uses repository-relative paths', () => {
    const projected = claudeDisplayInput('Edit', { file_path: '/repo/file.ts', old_string: 'before', new_string: 'after' }, '/repo', '/attachments');
    expect(projected.text).not.toContain('/repo/');
    expect(projected.review.text).toContain('/repo/file.ts');
  });

  it('omits unsupported credential fields and outside read paths with explicit unavailable review', () => {
    const projected = claudeDisplayInput('Read', { file_path: '/private/secret', headers: { authorization: 'secret-token' } }, '/repo', '/attachments');
    expect(projected.review.completeness).toBe('unavailable');
    expect(projected.text).toContain('omitted');
    expect(JSON.stringify(projected)).not.toContain('/private/secret');
    expect(JSON.stringify(projected)).not.toContain('secret-token');
  });

  it('keeps binary/structured results inert and strips terminal controls from text', () => {
    const output = displayResult([{ type: 'text', text: '\x1b[31mhello\x1b[0m' }, { type: 'image', source: { data: 'secret-image-bytes' } }, { type: 'resource', uri: 'secret-uri' }]);
    expect(output.text).toBe('hello\n[Image result omitted]\n[Non-text result omitted]');
    expect(displayResult({ headers: { secret: 'secret-token' } }).text).toBe('[Result details unavailable]');
  });

  it('bounds opaque identity bookkeeping without collapsing distinct large provider ids', () => {
    const large = 'id'.repeat(10000);
    expect(displayIdentity(['thread', large])).toBe(displayIdentity(['thread', large]));
    expect(displayIdentity(['thread', large])).not.toBe(displayIdentity(['other-thread', large]));
    expect(Buffer.byteLength(displayIdentity(['thread', large]))).toBeLessThan(1000);
  });
});
