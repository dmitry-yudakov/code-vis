'use client';

import Button from '@mui/material/Button';
import ListItemButton from '@mui/material/ListItemButton';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';

import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fuzzySearch } from '@/shared/fuzzySearch';
import type { ArenaMachineSnapshot, DurableProject } from '@/shared/types';
import { ProjectLogoButton } from './ProjectLogo';
import type { ProjectAction } from './ProjectActions';

interface ProjectOption {
  key: string;
  name: string;
  detail?: string;
  current?: boolean;
  logo?: ReactNode;
  actions?: ReactNode;
  open(): void;
}

function ProjectSearch({ options, children }: { options: ProjectOption[]; children?: ReactNode }) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightedKey, setHighlightedKey] = useState<string>();
  const matches = fuzzySearch(options, query, option => option.name.replace(/\s/g, ''));
  const highlighted = matches.find(option => option.key === highlightedKey)
    ?? (!query.trim() ? matches.find(option => option.current) : undefined) ?? matches[0];
  const activeId = focused && highlighted ? `${listId}-${highlighted.key}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return <>
    <TextField size="small" fullWidth placeholder="Search projects…" value={query}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => { setQuery(event.target.value); setHighlightedKey(undefined); }}
      slotProps={{ htmlInput: {
        role: 'combobox', 'aria-label': 'Search projects', 'aria-autocomplete': 'list',
        'aria-controls': listId, 'aria-expanded': true, 'aria-activedescendant': activeId, autoComplete: 'off',
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (!highlighted || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!event.repeat) highlighted.open();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = matches.indexOf(highlighted) + (event.key === 'ArrowDown' ? 1 : -1);
            setHighlightedKey(matches[(next + matches.length) % matches.length].key);
          }
        },
      } }}
    />
    {children}
    <div className="project-search-results" id={listId} role="listbox" aria-label="Projects">
      {matches.map(option => {
        const id = `${listId}-${option.key}`;
        const selected = focused ? option === highlighted : Boolean(option.current);
        const button = <ListItemButton key={option.key} id={id} component="button" type="button"
          role="option" aria-selected={selected} selected={selected} className="project-search-option" onClick={option.open}>
          <span>{option.name}</span>
          {option.detail && <small>{option.detail}</small>}
          {option.current && <i aria-hidden="true">✓</i>}
        </ListItemButton>;
        return option.logo ? <div className="project-record-option" key={option.key} role="presentation">
          {option.logo}{button}{option.actions}
        </div> : button;
      })}
    </div>
    {!matches.length && <p className="project-search-empty" role="status">
      {options.length ? 'No matching projects' : 'No projects available.'}
    </p>}
  </>;
}

export function ProjectPicker({ projects, value, disabled, apiBase, shortcut, onChange, onCreate, onManage, onLogo }: {
  projects: DurableProject[];
  value?: string;
  disabled?: boolean;
  apiBase?: string;
  shortcut?: boolean;
  onChange(value?: string): void;
  onCreate(name: string): void;
  onManage(project: DurableProject, action: ProjectAction): void;
  onLogo(project: DurableProject): void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const selected = projects.find((project) => project.id === value);

  return (
    <div className="project-picker-with-logo">
    {selected && <ProjectLogoButton project={selected} apiBase={apiBase} disabled={disabled} onClick={() => onLogo(selected)} />}
    <DesktopPopover className="project-search-picker" triggerClassName="project-search-trigger" disabled={disabled}
      label={`Project: ${selected?.name || 'No project'}`} width={390} placement="bottom-start" shortcutKey={shortcut ? 'k' : undefined}
      focusOnKeyboardOpen
      summary={<><span>{selected?.name || 'No project'}</span><ShellIcon name="chevronDown" /></>}>
      {(close) =>
        <ProjectSearch options={[
          { key: 'loose', name: 'No project', detail: 'Loose sessions', current: !value, open: () => { onChange(undefined); close(); } },
          ...projects.map(project => ({
            key: project.id, name: project.name, current: project.id === value,
            detail: `${project.repositories.length} ${project.repositories.length === 1 ? 'repository' : 'repositories'}`,
            open: () => { onChange(project.id); close(); },
            logo: <ProjectLogoButton project={project} apiBase={apiBase} onClick={() => { close(); onLogo(project); }} />,
            actions: <>
              <IconButton type="button" aria-label={`Rename ${project.name}`} onClick={() => { close(); onManage(project, 'rename'); }}>✎</IconButton>
              <IconButton type="button" aria-label={`Delete ${project.name}`} onClick={() => { close(); onManage(project, 'delete'); }}>×</IconButton>
            </>,
          })),
        ]}>
          <Button type="button" sx={{ display: 'flex', ml: 'auto', mt: 0.5 }} onClick={() => setCreating(true)}>New project</Button>
          {creating && (
            <form className="project-create-form" onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              onCreate(name.trim());
              setName('');
              setCreating(false);
            }}>
              <TextField autoFocus value={name} placeholder="Project name" onChange={(event) => setName(event.target.value)} slotProps={{ htmlInput: { "maxLength": 200, "aria-label": "Project name" } }} />
              <Button type="submit" disabled={!name.trim()}>Create</Button>
              <Button type="button" onClick={() => { setCreating(false); setName(''); }}>Cancel</Button>
            </form>
          )}
        </ProjectSearch>
      }
    </DesktopPopover>
    </div>
  );
}

export function ArenaProjectPicker({ machines, shortcut, onOpen }: {
  machines: ArenaMachineSnapshot[];
  shortcut: boolean;
  onOpen(projectId: string, machineId: string): void;
}) {
  const projects = machines.flatMap(({ machine, projects }) => machine.state === 'online'
    ? projects.map(project => ({ project, machine })) : []);
  return <DesktopPopover className="project-search-picker" triggerClassName="project-search-trigger" label="Projects"
    width={390} placement="bottom-start" shortcutKey={shortcut ? 'k' : undefined} focusOnKeyboardOpen
    summary={<><span>Projects</span><ShellIcon name="chevronDown" /></>}>
    {close => <ProjectSearch options={projects.map(({ project, machine }) => ({
      key: `${machine.id}:${project.id}`, name: project.name,
      detail: machines.length > 1 ? machine.label : undefined,
      open: () => { close(); onOpen(project.id, machine.id); },
    }))} />}
  </DesktopPopover>;
}
