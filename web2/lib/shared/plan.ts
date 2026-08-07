/** Machine contract for plan-mode answers. Shared so the browser and server agree on it. */
export const PLAN_START_MARKER = '<!-- cartograph:plan:start -->';
export const PLAN_END_MARKER = '<!-- cartograph:plan:end -->';

/** The follow-up an approved plan sends, in agent mode, resuming the same session. */
export const EXECUTE_PLAN_INSTRUCTION = 'The plan above is approved — implement it.';

/** True when a plan-mode answer actually delivered a plan the user can execute. */
export function hasProposedPlan(markdown: string): boolean {
  const start = markdown.indexOf(PLAN_START_MARKER);
  return start >= 0 && markdown.indexOf(PLAN_END_MARKER, start + PLAN_START_MARKER.length) > start;
}

/** Markers are a machine contract; readers should see the plan, not the scaffolding. */
export function stripPlanMarkers(markdown: string): string {
  return markdown.replaceAll(PLAN_START_MARKER, '').replaceAll(PLAN_END_MARKER, '');
}
