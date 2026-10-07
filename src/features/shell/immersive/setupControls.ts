export const SETUP_ACTIONS = {
  message: 'Message', attachments: 'Attachments', settings: 'Settings', agents: 'Agent settings', close: 'Cancel', clear: 'Clear',
  submit: 'Start', machine: 'Machine', project: 'Project', repository: 'Repository', execution: 'Execution', checkout: 'Checkout',
  provider: 'Provider', mode: 'Mode', instructions: 'Global instructions', model: 'Model', effort: 'Effort',
  previous: 'Previous attachment', next: 'Next attachment', attach: 'Attach report', remove: 'Remove attachment', files: 'Choose files', capture: 'Capture report',
  older: 'Previous details', newer: 'More details', open: 'Open session', outcome: 'Open session',
} as const;
export type SetupActionName = keyof typeof SETUP_ACTIONS;
export type SetupAction = `setup:${SetupActionName}`;
