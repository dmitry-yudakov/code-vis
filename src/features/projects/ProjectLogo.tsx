'use client';

import { useEffect, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import type { DurableProject } from '@/shared/types';
import { ShellIcon } from '@/features/shell/ShellIcon';

/** Decorative beside the project name; failed images leave the name in place. */
export function ProjectLogo({ project, apiBase = '/api', placeholder = false, loading }: {
  project: DurableProject; apiBase?: string; placeholder?: boolean; loading?: 'eager' | 'lazy';
}) {
  const source = `${apiBase}/projects/${encodeURIComponent(project.id)}/logo?choice=${encodeURIComponent(JSON.stringify(project.logo))}`;
  const [failed, setFailed] = useState<string>();
  useEffect(() => setFailed(undefined), [source]);
  if (!project.logo || failed === source) return placeholder ? <ShellIcon name="image" /> : null;
  // Repository images need the authenticated same-origin route rather than image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={source} className="project-logo" src={source} alt="" width={24} height={24}
    loading={loading} onError={() => setFailed(source)} />;
}

/** The same control adds a logo and edits the image already occupying that spot. */
export function ProjectLogoButton({ project, apiBase, disabled, loading, onClick }: {
  project: DurableProject; apiBase?: string; disabled?: boolean; loading?: 'eager' | 'lazy'; onClick(): void;
}) {
  return <IconButton type="button" aria-label={`Project logo for ${project.name}`} title="Project logo"
    disabled={disabled} onClick={onClick} sx={{ width: 32, height: 32, flexShrink: 0, p: 0.5 }}>
    <ProjectLogo project={project} apiBase={apiBase} loading={loading} placeholder />
  </IconButton>;
}
