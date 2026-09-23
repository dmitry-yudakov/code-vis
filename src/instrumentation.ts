/**
 * Runs once as the server starts. A server spawned by `start:managed` binds its lifecycle here, so
 * the parent's lease requests are answered before any route has loaded; every other mode does
 * nothing.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { managedBridge } = await import('@/server/lifecycle/managedBridge');
  if (!managedBridge()) return;
  const { getCodeAiLifecycle } = await import('@/server/lifecycle/codeAiLifecycle');
  getCodeAiLifecycle();
}
