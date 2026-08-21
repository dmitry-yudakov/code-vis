'use client';

export function AgentActivity({ running, label, startedAt }: { running: boolean; label: string; startedAt?: number }) {
  const elapsed = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
  return (
    <div className={`agent-activity ${running ? 'running' : ''}`} aria-live="polite">
      <span className="activity-dot" />
      <span>{label || 'Ready'}</span>
      {running && <span className="activity-time">{elapsed}s</span>}
    </div>
  );
}
