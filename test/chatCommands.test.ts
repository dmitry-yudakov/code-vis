import { describe, expect, it } from 'vitest';
import { chatCommand, commandSuggestions } from '@/features/conversation/chatCommands';

describe('local chat commands', () => {
  it('defaults autoclose to on and accepts explicit on/off', () => {
    expect(chatCommand(' /AUTOCLOSE ')).toEqual({ kind: 'autoclose', allowed: true });
    expect(chatCommand('/autoclose on')).toEqual({ kind: 'autoclose', allowed: true });
    expect(chatCommand('/autoclose off')).toEqual({ kind: 'autoclose', allowed: false });
    expect(chatCommand('/autoclose later')).toMatchObject({ kind: 'invalid' });
    expect(chatCommand('/autoclose\nPlease do work')).toMatchObject({ kind: 'invalid' });
  });

  it('maps close to archive and rejects arguments on session commands', () => {
    expect(chatCommand('/new')).toEqual({ kind: 'new' });
    expect(chatCommand('/archive')).toEqual({ kind: 'archive' });
    expect(chatCommand('/close')).toEqual({ kind: 'archive' });
    expect(chatCommand('/new something')).toMatchObject({ kind: 'invalid' });
    expect(chatCommand('/archive\nmore')).toMatchObject({ kind: 'invalid' });
  });

  it.each(['/model', '/src/app', '/archive.md', 'Explain /close', '/', '/autoarchive'])
    ('leaves ordinary text and provider commands alone: %s', text => {
      expect(chatCommand(text)).toBeUndefined();
    });

  it('filters commands and arguments without treating mentions or multiline input as completion', () => {
    expect(commandSuggestions('/').map(item => item.text)).toEqual(['/autoclose', '/new', '/archive', '/close']);
    expect(commandSuggestions('/AR').map(item => item.text)).toEqual(['/archive']);
    expect(commandSuggestions('/autoclose o').map(item => item.text)).toEqual(['/autoclose on', '/autoclose off']);
    expect(commandSuggestions('/autoclose off').map(item => item.text)).toEqual(['/autoclose off']);
    expect(commandSuggestions('/autoarchive')).toEqual([]);
    for (const text of ['Explain /', '/src/', '/new\n', '/archive later']) expect(commandSuggestions(text)).toEqual([]);
  });
});
