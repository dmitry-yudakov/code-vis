'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { commandSuggestions } from './chatCommands';

type CommandPlacement = 'top-start' | 'bottom-start';

/** Complete only the command at the caret, retaining the rest of the draft. */
export function useChatCommandInput(value: string, onChange: (text: string) => void, enabled: boolean,
  { placement, autocloseOnly = false }: { placement?: CommandPlacement; autocloseOnly?: boolean } = {}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const [selection, setSelection] = useState(false);
  const [selected, setSelected] = useState(0);
  const suggestions = enabled && focused && !dismissed && !selection ? commandSuggestions(value, cursor ?? value.length, autocloseOnly) : [];
  const selectedIndex = Math.min(selected, Math.max(0, suggestions.length - 1));
  const dismiss = () => setDismissed(true);
  const complete = (index: number) => {
    const suggestion = suggestions[index];
    const nextCursor = suggestion.start + suggestion.text.length;
    onChange(value.slice(0, suggestion.start) + suggestion.text + value.slice(suggestion.end));
    setCursor(nextCursor);
    dismiss();
    ref.current?.focus();
    requestAnimationFrame(() => ref.current?.setSelectionRange(nextCursor, nextCursor));
  };
  useEffect(() => {
    if (suggestions.length) document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, selectedIndex, suggestions.length]);
  return {
    ref, dismiss,
    list: <ChatCommandSuggestions id={listId} suggestions={suggestions} selected={selectedIndex} onComplete={complete} placement={placement} anchor={ref.current} />,
    aria: {
      'aria-autocomplete': enabled ? 'list' as const : undefined,
      'aria-expanded': enabled ? suggestions.length > 0 : undefined,
      'aria-controls': suggestions.length ? listId : undefined,
      'aria-activedescendant': suggestions.length ? `${listId}-${selectedIndex}` : undefined,
    },
    onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
      setDismissed(false); setSelected(0); setCursor(event.target.selectionStart ?? event.target.value.length);
      setSelection(false);
      onChange(event.target.value);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onSelect() {
      if (!ref.current) return;
      setCursor(ref.current.selectionStart);
      setSelection(ref.current.selectionStart !== ref.current.selectionEnd);
    },
    onKeyDown(event: KeyboardEvent) {
      if (event.nativeEvent.isComposing || !suggestions.length || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return true;
      }
      const suggestion = suggestions[selectedIndex];
      if (!event.repeat && (event.key === 'Tab' || (event.key === 'Enter' && value.slice(suggestion.start, suggestion.end).toLowerCase() !== suggestion.text))) {
        event.preventDefault(); complete(selectedIndex); return true;
      }
      return false;
    },
  };
}

function ChatCommandSuggestions({ id, suggestions, selected, onComplete, placement, anchor }: {
  id: string; suggestions: ReturnType<typeof commandSuggestions>; selected: number; onComplete(index: number): void;
  placement?: CommandPlacement; anchor: HTMLTextAreaElement | null;
}) {
  if (!suggestions.length) return null;
  const paper = <Paper variant="outlined" sx={{ ...(placement ? { width: anchor?.clientWidth, maxWidth: 'calc(100vw - 24px)' }
    : { position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2 }), maxHeight: 'min(320px, 45dvh)', overflow: 'auto' }}>
    <List id={id} role="listbox" aria-label="Chat commands" dense disablePadding>
      {suggestions.map((suggestion, index) => <ListItemButton key={suggestion.text} id={`${id}-${index}`}
        component="li" role="option" aria-selected={index === selected} selected={index === selected} tabIndex={-1}
        onMouseDown={event => event.preventDefault()} onClick={() => onComplete(index)}>
        <ListItemText primary={suggestion.text} secondary={suggestion.description} />
      </ListItemButton>)}
    </List>
  </Paper>;
  return placement ? <Popper open anchorEl={anchor} placement={placement} popperOptions={{ strategy: 'fixed' }}
    modifiers={[{ name: 'preventOverflow', options: { padding: 12 } }, { name: 'offset', options: { offset: [0, 4] } }]}
    sx={{ zIndex: theme => theme.zIndex.modal + 1 }}>{paper}</Popper> : paper;
}
