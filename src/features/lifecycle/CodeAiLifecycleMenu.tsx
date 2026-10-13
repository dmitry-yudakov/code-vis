'use client';

import Alert from '@mui/material/Alert';

import Button from '@mui/material/Button';

import { lifecycleConfirmation } from './lifecycleFlow';
import type { CodeAiLifecycleOwner } from './useCodeAiLifecycle';

/** Build & restart in the flat More menu: shown only where the server can do it, confirmed once. */
export function CodeAiLifecycleMenu({ lifecycle, checkoutName }: { lifecycle: CodeAiLifecycleOwner; checkoutName: string }) {
  return (
    <section className="lifecycle-menu" aria-label="Build and restart CodeAI">
      {lifecycle.confirming ? <>
        <Alert severity="warning">{lifecycleConfirmation(checkoutName)}</Alert>
        <div className="lifecycle-actions">
          <Button type="button" color="warning" variant="contained" onClick={lifecycle.confirm}>Build and restart</Button>
          <Button type="button" onClick={lifecycle.dismiss}>Cancel</Button>
        </div>
      </> : (
        <Button type="button" disabled={!lifecycle.canRequest} onClick={lifecycle.ask}>Build &amp; restart CodeAI</Button>
      )}
      {lifecycle.status && <p role="status">{lifecycle.status}</p>}
    </section>
  );
}
