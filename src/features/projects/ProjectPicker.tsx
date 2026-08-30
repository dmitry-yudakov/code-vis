'use client';

import { useEffect, useRef, useState } from 'react';
import type { DurableProject } from '@/shared/types';

export function ProjectPicker({ projects, value, disabled, onChange, onCreate, onRename, onDelete }: {
  projects: DurableProject[];
  value?: string;
  disabled?: boolean;
  onChange(value?: string): void;
  onCreate(name: string): void;
  onRename(project: DurableProject, name: string): void;
  onDelete(project: DurableProject): void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.id === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return (
    <div className="project-search-picker" ref={containerRef}>
      <button
        type="button"
        className="project-search-trigger"
        disabled={disabled}
        aria-label={`Project: ${selected?.name || 'No project'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.name || 'No project'}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="project-search-popover">
          <div className="project-search-meta">
            <strong>Projects</strong>
            <button type="button" onClick={() => setCreating(true)}>New project</button>
          </div>
          {creating && (
            <form className="project-create-form" onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              onCreate(name.trim());
              setName('');
              setCreating(false);
            }}>
              <input autoFocus value={name} maxLength={200} aria-label="Project name" placeholder="Project name" onChange={(event) => setName(event.target.value)} />
              <button type="submit" disabled={!name.trim()}>Create</button>
              <button type="button" onClick={() => { setCreating(false); setName(''); }}>Cancel</button>
            </form>
          )}
          <div className="project-search-results" role="listbox" aria-label="Projects">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`project-search-option${!value ? ' selected' : ''}`}
              onClick={() => { onChange(undefined); setOpen(false); }}
            >
              <span>No project</span><small>Loose sessions</small>{!value && <i aria-hidden="true">✓</i>}
            </button>
            {projects.map((project) => (
              <div className="project-record-option" key={project.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={project.id === value}
                  className={`project-search-option${project.id === value ? ' selected' : ''}`}
                  onClick={() => { onChange(project.id); setOpen(false); }}
                >
                  <span>{project.name}</span>
                  <small>{project.repositories.length} {project.repositories.length === 1 ? 'repository' : 'repositories'}</small>
                  {project.id === value && <i aria-hidden="true">✓</i>}
                </button>
                <button type="button" aria-label={`Rename ${project.name}`} onClick={() => {
                  const next = window.prompt('Project name', project.name)?.trim();
                  if (next && next !== project.name) onRename(project, next);
                }}>✎</button>
                <button type="button" aria-label={`Delete ${project.name}`} onClick={() => {
                  if (window.confirm(`Delete “${project.name}”? Its sessions will move to No project.`)) onDelete(project);
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
