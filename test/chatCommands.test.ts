import { describe, expect, it } from 'vitest';
import { chatCommand, commandSuggestions } from '@/features/conversation/chatCommands';

describe('local chat commands', () => {
  it('defaults autoclose to on and accepts explicit on/off', () => {
    expect(chatCommand(' /AUTOCLOSE ')).toEqual({ kind: 'autoclose', allowed: true });
    expect(chatCommand('/autoclose on')).toEqual({ kind: 'autoclose', allowed: true });
    expect(chatCommand('/autoclose off')).toEqual({ kind: 'autoclose', allowed: false });
    expect(chatCommand('/autoclose later')).toEqual({ kind: 'autoclose', allowed: true, remainingText: 'later' });
    expect(chatCommand('/autoclose\nPlease do work')).toEqual({ kind: 'autoclose', allowed: true, remainingText: 'Please do work' });
  });

  it('consumes inline autoclose controls and preserves the surrounding message', () => {
    expect(chatCommand('Do X, commit and close session /autoclose')).toEqual({ kind: 'autoclose', allowed: true, remainingText: 'Do X, commit and close session' });
    expect(chatCommand('Do X /autoclose off then report back')).toEqual({ kind: 'autoclose', allowed: false, remainingText: 'Do X then report back' });
    expect(chatCommand('Do X\n/autoclose off')).toEqual({ kind: 'autoclose', allowed: false, remainingText: 'Do X' });
    expect(chatCommand('Do X /autoclose off /autoclose on')).toEqual({ kind: 'autoclose', allowed: true, remainingText: 'Do X' });
    expect(chatCommand('Do X /autoclose off.')).toEqual({ kind: 'autoclose', allowed: false, remainingText: 'Do X' });
    expect(chatCommand('Do X /autoclose, then report back')).toEqual({ kind: 'autoclose', allowed: true, remainingText: 'Do X then report back' });
    expect(chatCommand('/autoclose off. Do X')).toEqual({ kind: 'autoclose', allowed: false, remainingText: 'Do X' });
  });

  it('maps close to archive and rejects arguments on session commands', () => {
    expect(chatCommand('/new')).toEqual({ kind: 'new' });
    expect(chatCommand('/archive')).toEqual({ kind: 'archive' });
    expect(chatCommand('/close')).toEqual({ kind: 'archive' });
    expect(chatCommand('/new something')).toMatchObject({ kind: 'invalid' });
    expect(chatCommand('/archive\nmore')).toMatchObject({ kind: 'invalid' });
  });

  it.each(['/model', '/src/app', '/archive.md', 'Explain /close', '/', '/autoarchive',
    'Read /autoclose.md', 'https://example.com/autoclose', 'Show `/autoclose off`', '```text\n/autoclose\n```', '~~~text\n/autoclose off\n~~~', 'Type \\/autoclose'])
    ('leaves ordinary text and provider commands alone: %s', text => {
      expect(chatCommand(text)).toBeUndefined();
    });

  it('filters commands and arguments, offering only autoclose within messages', () => {
    expect(commandSuggestions('/').map(item => item.text)).toEqual(['/autoclose', '/new', '/archive', '/close']);
    expect(commandSuggestions('/AR').map(item => item.text)).toEqual(['/archive']);
    expect(commandSuggestions('/autoclose o').map(item => item.text)).toEqual(['/autoclose on', '/autoclose off']);
    expect(commandSuggestions('/autoclose off').map(item => item.text)).toEqual(['/autoclose off']);
    expect(commandSuggestions('/autoarchive')).toEqual([]);
    expect(commandSuggestions('Do X /').map(item => item.text)).toEqual(['/autoclose']);
    expect(commandSuggestions('Do X /autoclose o').map(item => item.text)).toEqual(['/autoclose on', '/autoclose off']);
    expect(commandSuggestions('Do X\n/auto').map(item => item.text)).toEqual(['/autoclose']);
    expect(commandSuggestions('Do X /auto then report', 10)).toMatchObject([{ text: '/autoclose', start: 5, end: 10 }]);
    for (const text of ['/src/', '/new\n', '/archive later', 'Do X /ar', 'Show `/auto', '```\n/auto']) expect(commandSuggestions(text)).toEqual([]);
  });
});
