'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { groupProjects } from './projectPickerModel';
import type { ProjectSummary } from '@/shared/types';

export function ProjectPicker({ projects, recentProjectIds, value, discoveryDepth, disabled, onChange }: {
  projects: ProjectSummary[];
  recentProjectIds: string[];
  value: string;
  discoveryDepth: number;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((project) => project.id === value);
  const searching = Boolean(query.trim());
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return projects;
    return projects.filter((project) => {
      const haystack = `${project.name} ${project.relativePath}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [projects, query]);
  const { recent, other } = useMemo(
    () => groupProjects(projects, recentProjectIds),
    [projects, recentProjectIds],
  );

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const option = (project: ProjectSummary) => (
    <button
      type="button"
      role="option"
      aria-selected={project.id === value}
      className={`project-search-option${project.id === value ? ' selected' : ''}`}
      key={project.id}
      onClick={() => {
        if (project.id !== value) onChange(project.id);
        setOpen(false);
        setQuery('');
      }}
    >
      <span>{project.name}</span>
      <small>{project.relativePath === '.' ? 'Configured root' : project.relativePath}</small>
      {project.id === value && <i aria-hidden="true">✓</i>}
    </button>
  );

  return (
    <div className="project-search-picker" ref={containerRef}>
      <span className="picker-label">Project</span>
      <button
        type="button"
        className="project-search-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.name || 'Choose project'}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="project-search-popover">
          <div className="project-search-meta">
            <strong>{projects.length} {projects.length === 1 ? 'project' : 'projects'}</strong>
            <span>Depth {discoveryDepth}</span>
          </div>
          <label className="project-search-input">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search projects…"
              aria-label="Search projects"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            />
          </label>
          <div className="project-search-results" role="listbox" aria-label="Projects">
            {searching || !recent.length ? filtered.map(option) : (
              <>
                <div className="project-search-group" role="group" aria-label="Recent">
                  <div className="project-search-group-label" aria-hidden="true">Recent</div>
                  {recent.map(option)}
                </div>
                {!!other.length && (
                  <div className="project-search-group" role="group" aria-label="Other projects">
                    <div className="project-search-group-label" aria-hidden="true">Other projects</div>
                    {other.map(option)}
                  </div>
                )}
              </>
            )}
            {!filtered.length && <div className="project-search-empty">No projects match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
