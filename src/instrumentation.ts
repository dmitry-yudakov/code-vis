/**
 * Bind the managed lifecycle before routes load. Restore planned continuations on every runtime
 * startup, after supervisor acceptance when managed; never dispatch tasks in a rejected candidate.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { managedBridge } = await import('@/server/lifecycle/managedBridge');
  const bridge = managedBridge();
  const { resumeSuspendedTurns } = await import('@/server/lifecycle/resumeSuspendedTurns');
  if (bridge) {
    const { getCodeAiLifecycle } = await import('@/server/lifecycle/codeAiLifecycle');
    getCodeAiLifecycle();
    const { runRegistry } = await import('@/server/runs/runRegistry');
    const { parentLifecycleMessageSchema } = await import('@/shared/codeAiLifecycle');
    runRegistry.holdStartupRecovery();
    let accepted = false;
    bridge.listen(raw => {
      const message = parentLifecycleMessageSchema.safeParse(raw);
      // A candidate can listen successfully and still fail the supervisor's readiness rule.
      // Only its accepted idle snapshot authorizes restoring work; a rejected candidate runs none.
      if (accepted || !message.success || message.data.type !== 'lifecycle-state' || message.data.snapshot.phase !== 'idle') return;
      accepted = true;
      void resumeSuspendedTurns().catch(error => console.error('CodeAI restart recovery could not start:', error))
        .finally(() => runRegistry.releaseMaintenance());
    });
    return;
  }
  await resumeSuspendedTurns();
}
