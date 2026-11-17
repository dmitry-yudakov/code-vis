export type ChatCommand = { kind: 'autoclose'; allowed: boolean } | { kind: 'new' | 'archive' }
  | { kind: 'invalid'; usage: string };

const COMMANDS = [
  { text: '/autoclose', description: 'Allow the agent to archive when finished' },
  { text: '/new', description: 'New chat with the same project and settings' },
  { text: '/archive', description: 'Archive this session' },
  { text: '/close', description: 'Archive this session' },
];

/** Only complete, standalone local commands are consumed; other provider commands stay intact. */
export function chatCommand(text: string): ChatCommand | undefined {
  const match = /^\/(autoclose|new|archive|close)(?=\s|$)([\s\S]*)$/i.exec(text.trim());
  if (!match) return;
  const name = match[1].toLowerCase();
  if (name === 'autoclose') {
    const argument = /^(?:[ \t]+(on|off))?$/i.exec(match[2]);
    return argument ? { kind: 'autoclose', allowed: argument[1]?.toLowerCase() !== 'off' }
      : { kind: 'invalid', usage: `Use /${name}, /${name} on or /${name} off.` };
  }
  return match[2] ? { kind: 'invalid', usage: `Use /${name} without arguments.` }
    : { kind: name === 'new' ? 'new' : 'archive' };
}

export function commandSuggestions(text: string) {
  if (!/^\/[a-z]*(?:[ \t]+[a-z]*)?$/i.test(text.trimStart())) return [];
  const query = text.trimStart().toLowerCase();
  const argument = /^\/(autoclose)[ \t]+/i.exec(query);
  const choices = argument ? [
    { text: `/${argument[1]} on`, description: 'Allow the agent to archive when finished' },
    { text: `/${argument[1]} off`, description: 'Turn off automatic archiving' },
  ] : COMMANDS;
  return choices.filter(choice => choice.text.startsWith(query));
}
