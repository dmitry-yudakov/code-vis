import { describe, expect, it } from 'vitest';
import { permissionRequestUpdate } from '@/features/shell/immersive/sessionControls';

describe('routed immersive permission requests', () => {
  it('applies a routed request once and then leaves the review where the reviewer put it', () => {
    const applied = permissionRequestUpdate(undefined, 'request-a', true);
    expect(applied).toEqual({ applied: 'request-a', apply: true });
    // The Arena poll rebuilds the permission array every two seconds; the same key must not
    // reselect the request or send the reader back to the first page of the command.
    expect(permissionRequestUpdate(applied.applied, 'request-a', true)).toEqual({ applied: 'request-a', apply: false });
  });

  it('waits until the requested key resolves to a pending request', () => {
    const waiting = permissionRequestUpdate(undefined, 'request-a', false);
    expect(waiting).toEqual({ applied: undefined, apply: false });
    expect(permissionRequestUpdate(waiting.applied, 'request-a', true)).toEqual({ applied: 'request-a', apply: true });
    // An answered request leaves the key in place; it must not re-apply when it stops being pending.
    expect(permissionRequestUpdate('request-a', 'request-a', false)).toEqual({ applied: 'request-a', apply: false });
  });

  it('applies a different key, and re-arms the same key once the route is cleared', () => {
    expect(permissionRequestUpdate('request-a', 'request-b', true)).toEqual({ applied: 'request-b', apply: true });
    const cleared = permissionRequestUpdate('request-a', undefined, false);
    expect(cleared).toEqual({ applied: undefined, apply: false });
    expect(permissionRequestUpdate(cleared.applied, 'request-a', true)).toEqual({ applied: 'request-a', apply: true });
  });
});
