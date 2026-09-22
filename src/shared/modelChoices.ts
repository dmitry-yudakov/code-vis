import type { ModelChoices, ModelSelection } from './types';

/** Efforts a turn may name: the chosen model's, or the Default list when no model is named. */
export function offeredEfforts(choices: ModelChoices | undefined, model?: string): string[] {
  return (model ? choices?.models?.find((item) => item.id === model)?.efforts : choices?.efforts) ?? [];
}

/**
 * The part of a selection the provider still lists. Anything else is Default, the same fallback an
 * unsupported mode uses. The message route rejects a request this function would change.
 */
export function offeredModelSelection(selection: ModelSelection | undefined, choices: ModelChoices | undefined): ModelSelection {
  const model = selection?.model && choices?.models?.some((item) => item.id === selection.model) ? selection.model : undefined;
  const effort = selection?.effort && offeredEfforts(choices, model).includes(selection.effort) ? selection.effort : undefined;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
