type AutocloseCommand = { kind: 'autoclose'; allowed: boolean; remainingText?: string };
export type ChatCommand = AutocloseCommand | { kind: 'new' | 'archive' }
  | { kind: 'invalid'; usage: string };

const COMMANDS = [
  { text: '/autoclose', description: 'Allow the agent to archive when finished' },
  { text: '/new', description: 'New chat with the same project and settings' },
  { text: '/archive', description: 'Archive this session' },
  { text: '/close', description: 'Archive this session' },
];

/** Session actions are standalone. Bare autoclose tokens also control a composed message. */
export function chatCommand(text: string): ChatCommand | undefined {
  const action = /^\/(new|archive|close)(?=\s|$)([\s\S]*)$/i.exec(text.trim());
  if (action) {
    const name = action[1].toLowerCase();
    return action[2] ? { kind: 'invalid', usage: `Use /${name} without arguments.` }
      : { kind: name === 'new' ? 'new' : 'archive' };
  }
  return autocloseCommand(text);
}

export function autocloseCommand(text: string): AutocloseCommand | undefined {
  let allowed: boolean | undefined;
  let remaining = '', offset = 0;
  // Consume code spans/fences as a whole so examples stay literal, including unfinished code.
  for (const match of text.matchAll(/(`+|~{3,})[\s\S]*?(?:\1|$)|(^|\s)\/autoclose(?=\s|$|[.,!?;:](?=\s|$))(?:[ \t]+(on|off)(?=\s|$|[.,!?;:](?=\s|$)))?(?:[.,!?;:](?=\s|$))?/gi)) {
    if (match[1]) continue;
    allowed = match[3]?.toLowerCase() !== 'off';
    const start = match.index + match[2].length;
    remaining += text.slice(offset, start);
    offset = match.index + match[0].length;
    while (/[ \t]/.test(text[offset] || '') && offset < text.length) offset++;
  }
  if (allowed === undefined) return;
  remaining = (remaining + text.slice(offset)).trim();
  return { kind: 'autoclose', allowed, ...(remaining ? { remainingText: remaining } : {}) };
}

export function commandSuggestions(text: string, cursor = text.length, autocloseOnly = false) {
  const match = /(^|\s)(\/[a-z]*(?:[ \t]+[a-z]*)?)$/i.exec(text.slice(0, cursor));
  if (!match) return [];
  const start = match.index + match[1].length;
  if ([...text.matchAll(/(`+|~{3,})[\s\S]*?(?:\1|$)/g)].some(code => code.index <= start && start < code.index + code[0].length)) return [];
  const query = match[2].toLowerCase();
  const argument = /^\/(autoclose)[ \t]+/i.exec(query);
  const choices = argument ? [
    { text: `/${argument[1]} on`, description: 'Allow the agent to archive when finished' },
    { text: `/${argument[1]} off`, description: 'Turn off automatic archiving' },
  ] : autocloseOnly || text.slice(0, start).trim() ? COMMANDS.slice(0, 1) : COMMANDS;
  const end = cursor + (/^[a-z]*/i.exec(text.slice(cursor))?.[0].length || 0);
  return choices.filter(choice => choice.text.startsWith(query)).map(choice => ({ ...choice, start, end }));
}
