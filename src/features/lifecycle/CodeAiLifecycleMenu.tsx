'use client';

import { lifecycleConfirmation } from './lifecycleFlow';
import type { CodeAiLifecycleOwner } from './useCodeAiLifecycle';

/** Build & restart in the flat More menu: shown only where the server can do it, confirmed once. */
export function CodeAiLifecycleMenu({ lifecycle, checkoutName }: { lifecycle: CodeAiLifecycleOwner; checkoutName: string }) {
  return (
    <section className="lifecycle-menu" aria-label="Build and restart CodeAI">
      {lifecycle.confirming ? <>
        <p className="lifecycle-warning" role="alert">{lifecycleConfirmation(checkoutName)}</p>
        <div className="lifecycle-actions">
          <button type="button" className="lifecycle-confirm" onClick={lifecycle.confirm}>Build and restart</button>
          <button type="button" onClick={lifecycle.dismiss}>Cancel</button>
        </div>
      </> : (
        <button type="button" disabled={!lifecycle.canRequest} onClick={lifecycle.ask}>Build &amp; restart CodeAI</button>
      )}
      {lifecycle.status && <p role="status">{lifecycle.status}</p>}
    </section>
  );
}
