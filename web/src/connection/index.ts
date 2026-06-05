import { SocketConnection } from './connection';
import {
  ChangeSourceRequest,
  CommitSummary,
  Entity,
  FileMapDetailed,
  FocusedReviewOptions,
  FocusedReviewMap,
  OpenProjectResponse,
  ProjectListResponse,
  Relation,
  ReviewArrangementResult,
} from '../types';

let connection: SocketConnection | null = null;

/**
 * Initialize the Socket.IO connection
 */
export const initConnection = (url: string, options = {}) => {
  connection = new SocketConnection({
    url,
    ...options,
  });
  return connection;
};

/**
 * Get the active connection instance
 */
export const getConnection = (): SocketConnection => {
  if (!connection) {
    throw new Error('Connection not initialized. Call initConnection first.');
  }
  return connection;
};

/**
 * Check if connected
 */
export const isConnected = (): boolean => {
  return connection?.isConnected() || false;
};

/**
 * Type-safe API for project operations
 */
export const projectApi = {
  /**
   * List projects available from the server root.
   */
  async listProjects(): Promise<ProjectListResponse> {
    console.log('CLIENT: projectApi.listProjects() called');
    const result = await getConnection().request<ProjectListResponse>(
      'listProjects'
    );
    console.log('CLIENT: projectApi.listProjects() received', {
      projects: result?.projects?.length ?? 0,
      activeProjectId: result?.activeProjectId,
    });
    return result;
  },

  /**
   * Open a project and receive its initial project map.
   */
  async openProject(projectId: string): Promise<OpenProjectResponse> {
    console.log('CLIENT: projectApi.openProject() called', { projectId });
    const result = await getConnection().request<OpenProjectResponse>(
      'openProject',
      { projectId }
    );
    console.log('CLIENT: projectApi.openProject() received', {
      project: result?.project?.name,
      mapLength: result?.projectMap?.length ?? 0,
    });
    return result;
  },

  /**
   * Get project map (file hierarchy)
   */
  async getProjectMap() {
    console.log('CLIENT: projectApi.getProjectMap() called');
    const result = await getConnection().request<any[]>('mapProject');
    console.log('CLIENT: projectApi.getProjectMap() received', {
      resultType: typeof result,
      isArray: Array.isArray(result),
      length: result ? result.length : 'null/undefined',
    });
    return result;
  },

  /**
   * Get detailed file mapping
   */
  async getFileMap(
    filename: string,
    includeRelated = false
  ): Promise<FileMapDetailed[]> {
    console.log('CLIENT: projectApi.getFileMap() called', {
      filename,
      includeRelated,
    });
    const result = await getConnection().request<FileMapDetailed[]>('mapFile', {
      filename,
      includeRelated,
    });
    console.log('CLIENT: projectApi.getFileMap() received', {
      resultType: typeof result,
      isArray: Array.isArray(result),
      length: result ? result.length : 'null/undefined',
    });
    return result;
  },

  /**
   * Get focused review map (diff or branch-vs-base)
   */
  async getFocusedReview(
    source: ChangeSourceRequest,
    options: FocusedReviewOptions = {}
  ): Promise<FocusedReviewMap> {
    console.log('CLIENT: projectApi.getFocusedReview() called', {
      source,
      options,
    });
    const result = await getConnection().request<FocusedReviewMap>(
      'mapFocusedReview',
      { source, options }
    );
    console.log('CLIENT: projectApi.getFocusedReview() received', {
      changedFiles: result?.changeSet?.files?.length ?? 0,
      focusedFiles: result?.files?.length ?? 0,
      includes: result?.includes?.length ?? 0,
      declarations: result?.declarations?.length ?? 0,
      declarationCalls: result?.declarationCalls?.length ?? 0,
    });
    return result;
  },

  /**
   * On-demand LLM arrangement over a review slice (M2). Sends the entities /
   * relations the client already holds and gets back an editorial Arrangement
   * to overlay (or null when no LLM is configured / the model produced nothing).
   */
  async arrangeReview(
    entities: Entity[],
    relations: Relation[]
  ): Promise<ReviewArrangementResult> {
    console.log('CLIENT: projectApi.arrangeReview() called', {
      entities: entities.length,
      relations: relations.length,
    });
    // Generous client timeout so the server's own LLM timeout always wins and
    // returns { arrangement: null } rather than the client racing it to an error.
    // Keep this comfortably ABOVE the server's CODEAI_LLM_TIMEOUT_MS (the real
    // bound on the model call) — raise it too if you set that env higher.
    const result = await getConnection().request<ReviewArrangementResult>(
      'arrangeReview',
      { entities, relations },
      180000
    );
    console.log('CLIENT: projectApi.arrangeReview() received', {
      available: result?.available,
      hasArrangement: !!result?.arrangement,
    });
    return result;
  },

  /**
   * Get recent commits from the current branch.
   */
  async listCommits(
    options: { limit?: number; skip?: number } = {}
  ): Promise<CommitSummary[]> {
    console.log('CLIENT: projectApi.listCommits() called', options);
    const result = await getConnection().request<CommitSummary[]>(
      'listCommits',
      options
    );
    console.log('CLIENT: projectApi.listCommits() received', {
      commits: result?.length ?? 0,
    });
    return result;
  },

  /**
   * Save file content
   */
  async saveFile(
    filename: string,
    content: string,
    pos?: number,
    end?: number
  ) {
    return getConnection().request('saveFile', {
      filename,
      content,
      pos,
      end,
    });
  },

  /**
   * Subscribe to project content changes
   */
  onProjectChange(handler: (event: any) => void) {
    console.log('CLIENT: projectApi.onProjectChange() subscribed');
    return getConnection().on('projectContentChange', (event) => {
      console.log('CLIENT: projectContentChange event received', event);
      handler(event);
    });
  },

  /**
   * Subscribe to project map updates
   */
  onProjectMap(handler: (data: any) => void) {
    console.log('CLIENT: projectApi.onProjectMap() subscribed');
    return getConnection().on('projectMap', (data) => {
      console.log('CLIENT: projectMap event received', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      handler(data);
    });
  },

  /**
   * Subscribe to file map updates
   */
  onFileMap(handler: (data: any) => void) {
    console.log('CLIENT: projectApi.onFileMap() subscribed');
    return getConnection().on('fileMap', (data) => {
      console.log('CLIENT: fileMap event received', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      handler(data);
    });
  },

  /**
   * Subscribe to project list updates.
   */
  onProjectsList(handler: (data: ProjectListResponse) => void) {
    console.log('CLIENT: projectApi.onProjectsList() subscribed');
    return getConnection().on('projectsList', (data) => {
      console.log('CLIENT: projectsList event received', {
        projects: data?.projects?.length ?? 0,
        activeProjectId: data?.activeProjectId,
      });
      handler(data);
    });
  },

  /**
   * Subscribe to active project changes.
   */
  onActiveProjectChanged(handler: (data: OpenProjectResponse) => void) {
    console.log('CLIENT: projectApi.onActiveProjectChanged() subscribed');
    return getConnection().on('activeProjectChanged', (data) => {
      console.log('CLIENT: activeProjectChanged event received', {
        project: data?.project?.name,
        mapLength: data?.projectMap?.length ?? 0,
      });
      handler(data);
    });
  },
};

/**
 * Legacy compatibility functions
 */
export const sendToServer = (command: string, payload?: any) => {
  if (!connection) {
    console.warn('Connection not initialized');
    return;
  }
  connection.emit(command, payload);
};

export const requestFromServer = async (command: string, payload?: any) => {
  return getConnection().request(command, payload);
};

export const disconnect = () => {
  connection?.disconnect();
  connection = null;
};

// Re-export types and classes
export { SocketConnection } from './connection';
export type { SocketOptions } from './connection';
