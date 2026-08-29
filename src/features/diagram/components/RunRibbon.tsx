import type { ToolActivityEntry } from '@/features/agents/toolActivity';

export function RunRibbon({ running, failed, pendingApprovals, activity }: {
  running: boolean;
  failed: boolean;
  pendingApprovals: number;
  activity: ToolActivityEntry[];
}) {
  if (failed) {
    return (
      <div className="run-ribbon failed" aria-label="Agent run failed">
        <span className="run-ribbon-line" />
      </div>
    );
  }

  if (pendingApprovals > 0) {
    return (
      <div className="run-ribbon awaiting-approval" aria-label="Agent run awaiting approval">
        <span className="run-ribbon-line" />
      </div>
    );
  }

  if (!running || activity.length === 0) {
    return (
      <div className="run-ribbon idle" aria-label={running ? 'Agent run starting' : 'No active agent run'}>
        <span className="run-ribbon-line" />
      </div>
    );
  }

  return (
    <div className="run-ribbon working" aria-label={`${activity.length} recent agent tool ${activity.length === 1 ? 'call' : 'calls'}`}>
      <span className="run-ribbon-trace">
        {activity.map((entry, index) => (
          <span
            className={`run-ribbon-tick ${entry.denied ? 'denied' : ''} ${index === activity.length - 1 ? 'newest' : ''}`}
            key={entry.key}
            title={`${entry.denied ? 'Denied — ' : ''}${entry.tool}${entry.detail ? ` — ${entry.detail}` : ''}`}
          />
        ))}
      </span>
    </div>
  );
}
