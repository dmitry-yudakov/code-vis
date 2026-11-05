'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { ShellIcon } from '@/features/shell/ShellIcon';

export function CodeBlock({ children, warning }: { children?: ReactNode; warning?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copyState, setCopyState] = useState<'copied' | 'failed'>();
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  return <div className="code-block">
    {warning && <div className="block-warning">{warning}</div>}
    <Box sx={{ border: '1px solid var(--line)', borderRadius: '10px', overflow: 'hidden', background: 'var(--code-surface)', color: 'var(--code-ink)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 0.5, px: 0.75, py: 0.25, fontSize: 11,
        '& .shell-icon': { width: 16, height: 16 } }}>
        {copyState && <span role="status">{copyState === 'copied' ? 'Copied' : 'Could not copy. Try again.'}</span>}
        <Tooltip title="Copy code">
          <IconButton type="button" size="small" color="inherit" aria-label="Copy code" onClick={async () => {
            try { await navigator.clipboard.writeText(pre.current?.textContent || ''); setCopyState('copied'); }
            catch { setCopyState('failed'); }
          }}><ShellIcon name="copy" /></IconButton>
        </Tooltip>
      </Box>
      <pre ref={pre}>{children}</pre>
    </Box>
  </div>;
}
