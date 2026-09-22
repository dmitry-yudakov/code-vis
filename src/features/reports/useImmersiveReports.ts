'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImmersiveReportList, ImmersiveReportSummary } from '@/shared/immersiveReport';

export const IMMERSIVE_REPORTS_PATH = '/api/immersive/reports';
const NO_REPORTS: ImmersiveReportSummary[] = [];

export function immersiveReportPath(projectId: string, reportId: string, image = false): string {
  return `${IMMERSIVE_REPORTS_PATH}/${encodeURIComponent(reportId)}${image ? '/image' : ''}?projectId=${encodeURIComponent(projectId)}`;
}

export interface ImmersiveReportsOwner {
  projectId?: string;
  available: boolean;
  reports: ImmersiveReportSummary[];
  skipped: number;
  loading: boolean;
  error?: string;
  refresh(): Promise<void>;
  /** Whether the home machine last answered that this project is CodeAI's own. */
  isSelfProject(projectId?: string): boolean;
}

/**
 * The one owner of the home machine's report list, shared by the flat Reports tab and the headset.
 * The server decides availability on every request; this only remembers its latest answers.
 */
export function useImmersiveReports(projectId?: string): ImmersiveReportsOwner {
  const [state, setState] = useState<{ projectId?: string; list?: ImmersiveReportList; loading: boolean; error?: string }>({ loading: false });
  const latestRequest = useRef(0);
  const selfProjects = useRef(new Set<string>());
  // A refresh requested by a delayed callback reads whichever project is selected when it runs.
  const currentProjectId = useRef(projectId);
  currentProjectId.current = projectId;

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    const projectId = currentProjectId.current;
    if (!projectId) {
      setState({ loading: false });
      return;
    }
    setState((current) => current.projectId === projectId
      ? { ...current, loading: true, error: undefined }
      : { projectId, loading: true });
    try {
      const response = await fetch(`${IMMERSIVE_REPORTS_PATH}?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as Partial<ImmersiveReportList> & { error?: string };
      if (!response.ok || typeof data.available !== 'boolean') throw new Error(data.error || 'Reports could not be loaded.');
      if (data.available) selfProjects.current.add(projectId);
      else selfProjects.current.delete(projectId);
      if (request === latestRequest.current) setState({ projectId, list: data as ImmersiveReportList, loading: false });
    } catch (error) {
      if (request === latestRequest.current) {
        setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Reports could not be loaded.' }));
      }
    }
  }, []);

  useEffect(() => { void refresh(); }, [projectId, refresh]);

  const list = state.projectId === projectId ? state.list : undefined;
  const isSelfProject = useCallback((id?: string) => Boolean(id && selfProjects.current.has(id)), []);
  return {
    projectId,
    available: list?.available === true,
    reports: list?.available ? list.reports : NO_REPORTS,
    skipped: list?.available ? list.skipped : 0,
    loading: state.projectId === projectId && state.loading,
    error: state.projectId === projectId ? state.error : undefined,
    refresh,
    isSelfProject,
  };
}
