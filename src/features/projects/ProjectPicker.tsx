'use client';

import Button from '@mui/material/Button';
import ListItemButton from '@mui/material/ListItemButton';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';

import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { useState } from 'react';
import type { DurableProject } from '@/shared/types';
import { ProjectLogoButton } from './ProjectLogo';
import type { ProjectAction } from './ProjectActions';

export function ProjectPicker({ projects, value, disabled, apiBase, onChange, onCreate, onManage, onLogo }: {
  projects: DurableProject[];
  value?: string;
  disabled?: boolean;
  apiBase?: string;
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
      label={`Project: ${selected?.name || 'No project'}`} width={390} placement="bottom-start"
      summary={<><span>{selected?.name || 'No project'}</span><ShellIcon name="chevronDown" /></>}>
      {(close) =>
        <div className="project-search-popover">
          <div className="project-search-meta">
            <strong>Projects</strong>
            <Button type="button" onClick={() => setCreating(true)}>New project</Button>
          </div>
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
          <div className="project-search-results" role="listbox" aria-label="Projects">
            <ListItemButton component="button"
              type="button" role="option" aria-selected={!value} selected={!value} className={`project-search-option${!value ? ' selected' : ''}`} onClick={() => { onChange(undefined); close(); }}
            >
              <span>No project</span><small>Loose sessions</small>{!value && <i aria-hidden="true">✓</i>}
            </ListItemButton>
            {projects.map((project) => (
              <div className="project-record-option" key={project.id}>
                <ProjectLogoButton project={project} apiBase={apiBase} onClick={() => { close(); onLogo(project); }} />
                <ListItemButton component="button"
                  type="button" role="option" aria-selected={project.id === value} selected={project.id === value} className={`project-search-option${project.id === value ? ' selected' : ''}`} onClick={() => { onChange(project.id); close(); }}
                >
                  <span>{project.name}</span>
                  <small>{project.repositories.length} {project.repositories.length === 1 ? 'repository' : 'repositories'}</small>
                  {project.id === value && <i aria-hidden="true">✓</i>}
                </ListItemButton>
                <IconButton type="button" aria-label={`Rename ${project.name}`} onClick={() => { close(); onManage(project, 'rename'); }}>✎</IconButton>
                <IconButton type="button" aria-label={`Delete ${project.name}`} onClick={() => { close(); onManage(project, 'delete'); }}>×</IconButton>
              </div>
            ))}
          </div>
        </div>
      }
    </DesktopPopover>
    </div>
  );
}
