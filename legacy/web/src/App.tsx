import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import './App.css';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useParams,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import lodash from 'lodash';
import { initConnection, projectApi } from './connection';
import { History } from './components/History';
import {
  ChangeSourceRequest,
  CodeMapScope,
  CommitSummary,
  Entity,
  FileIncludeInfo,
  FileMapDetailed,
  FocusedReviewOptions,
  OpenProjectResponse,
  ProjectChangeEvent,
  ProjectInfo,
  ProjectListResponse,
  Relation,
} from './types';
import { IncludesHierarchy } from './components/IncludesHierarchy';
import { LogicMap } from './components/LogicMap';
import Menu from './atoms/Menu';
import { FilesMapping } from './components/FilesMapping';
import { getDefaultSocketUrl } from './connection/socketUrl';

const url = getDefaultSocketUrl();

const ProjectDataContext = React.createContext<{
  projectMap: FileIncludeInfo[];
  filesMappings: Record<string, FileMapDetailed>;
  forceReloadToken: number;
  activeProject: ProjectInfo | null;
}>({
  projectMap: [],
  filesMappings: {},
  forceReloadToken: 0,
  activeProject: null,
});

const formatProjectDate = (value?: string) => {
  if (!value) return 'Not opened yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ProjectPicker: React.FC<{
  projects: ProjectInfo[];
  rootPath: string;
  openingProjectId: string | null;
  error: string | null;
  onOpenProject: (projectId: string) => void;
}> = ({ projects, rootPath, openingProjectId, error, onOpenProject }) => {
  const recentlyOpened = projects.filter((project) => !!project.lastOpenedAt);
  const visibleProjects = projects.length > 0 ? projects : [];

  return (
    <main className="project-picker">
      <section className="project-picker-shell">
        <div className="project-picker-header">
          <div>
            <div className="project-picker-eyebrow">Projects</div>
            <h1>Choose a codebase</h1>
            <div className="project-picker-root">{rootPath}</div>
          </div>
          <div className="project-picker-count">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </div>
        </div>

        {recentlyOpened.length > 0 && (
          <div className="project-section">
            <div className="project-section-title">Recently opened</div>
            <div className="project-recent-list">
              {recentlyOpened.slice(0, 3).map((project) => (
                <button
                  key={project.id}
                  className="project-recent-button"
                  onClick={() => onOpenProject(project.id)}
                  disabled={openingProjectId === project.id}
                >
                  <span>{project.name}</span>
                  <small>{formatProjectDate(project.lastOpenedAt)}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="project-section">
          <div className="project-section-title">Last modified</div>
          {error && <div className="project-error">{error}</div>}
          {visibleProjects.length === 0 ? (
            <div className="project-empty">
              No project directories were found in this location.
            </div>
          ) : (
            <div className="project-list">
              {visibleProjects.map((project) => (
                <button
                  key={project.id}
                  className="project-row"
                  onClick={() => onOpenProject(project.id)}
                  disabled={openingProjectId === project.id}
                >
                  <span className="project-row-main">
                    <span className="project-row-name">{project.name}</span>
                    <span className="project-row-path">{project.path}</span>
                  </span>
                  <span className="project-row-meta">
                    {openingProjectId === project.id
                      ? 'Opening...'
                      : formatProjectDate(project.mtime)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
};

const ProjectSwitcher: React.FC<{
  projects: ProjectInfo[];
  activeProject: ProjectInfo | null;
  openingProjectId: string | null;
  onOpenProject: (projectId: string) => void;
}> = ({ projects, activeProject, openingProjectId, onOpenProject }) => {
  if (projects.length <= 1 || !activeProject) return null;

  return (
    <label className="project-switcher">
      <span>Project</span>
      <select
        value={activeProject.id}
        onChange={(event) => onOpenProject(event.currentTarget.value)}
        disabled={!!openingProjectId}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
};

const FileScreen: React.FC<{ fineGrained?: boolean }> = ({
  fineGrained = false,
}) => {
  const { filename: filenameEnc } = useParams<{ filename: string }>();
  const filename = decodeURIComponent(filenameEnc || '');
  const navigate = useNavigate();
  const location = useLocation();

  const { projectMap, filesMappings, forceReloadToken, activeProject } =
    useContext(ProjectDataContext);
  const codeMapScope = useMemo(() => {
    const state = location.state as { codeMapScope?: CodeMapScope } | null;
    return state?.codeMapScope || null;
  }, [location.state]);
  const scopedFiles = useMemo(
    () => new Set(codeMapScope?.files || []),
    [codeMapScope]
  );
  const scopedProjectMap = useMemo(() => {
    if (!codeMapScope || scopedFiles.size === 0) return projectMap;
    return projectMap.filter(
      (incl) => scopedFiles.has(incl.from) && scopedFiles.has(incl.to)
    );
  }, [codeMapScope, projectMap, scopedFiles]);
  const scopeKey = codeMapScope?.scopeId || 'full-project';

  const [localFileData, setLocalFileData] = useState<FileMapDetailed | null>(
    null
  );
  const [relatedFiles, setRelatedFiles] = useState<
    Record<string, FileMapDetailed>
  >({});

  useEffect(() => {
    // Check if we already have the data in context
    const cachedData = filesMappings[filename];
    if (cachedData) {
      console.log('FileScreen: Using cached data for', filename);
      setLocalFileData(cachedData);
      return;
    }

    // Otherwise, fetch it
    console.log('FileScreen: Fetching file map for', filename);
    projectApi
      .getFileMap(filename, true)
      .then((data) => {
        console.log('FileScreen: Received file map data', {
          dataType: typeof data,
          isArray: Array.isArray(data),
          length: data ? data.length : 0,
          files: data ? data.map((f: any) => f.filename) : [],
        });
        // The data is an array of file mappings
        if (Array.isArray(data) && data.length > 0) {
          // First item should be the main file
          const mainFile =
            data.find((f: any) => f.filename === filename) || data[0];
          setLocalFileData(mainFile);

          // Store all files (including related) for onRequestRelatedFile
          const allFilesMap: Record<string, FileMapDetailed> = {};
          data.forEach((fileMap: any) => {
            if (fileMap && fileMap.filename) {
              allFilesMap[fileMap.filename] = fileMap;
            }
          });
          console.log(
            'FileScreen: Stored related files',
            Object.keys(allFilesMap)
          );
          setRelatedFiles(allFilesMap);
        }
      })
      .catch((err) => {
        console.error('Error loading file map:', err);
      });
  }, [filename, forceReloadToken, filesMappings]);

  // Create a merged map for onRequestRelatedFile that includes both context and local data
  // Use useCallback to ensure the function updates when relatedFiles changes
  const getRelatedFile = useCallback(
    (fn: string) => {
      if (codeMapScope && scopedFiles.size > 0 && !scopedFiles.has(fn)) {
        return null;
      }

      const result = relatedFiles[fn] || filesMappings[fn] || null;
      console.log('getRelatedFile called', {
        requestedFile: fn,
        scopeId: codeMapScope?.scopeId,
        foundInRelated: !!relatedFiles[fn],
        foundInContext: !!filesMappings[fn],
        hasResult: !!result,
        relatedFilesKeys: Object.keys(relatedFiles),
      });
      return result;
    },
    [codeMapScope, scopedFiles, relatedFiles, filesMappings]
  );

  if (!activeProject) {
    return (
      <div className="project-route-empty">
        Select a project to open file maps.
      </div>
    );
  }

  const fileData = localFileData || filesMappings[filename];
  if (!fileData) return <div>Loading...</div>;

  return fineGrained ? (
    <LogicMap
      key={`${filename}-${scopeKey}-${Object.keys(relatedFiles).length}`}
      filename={filename}
      projectMap={scopedProjectMap}
      onClose={() => navigate('/')}
      onRequestRelatedFile={getRelatedFile}
      onSave={async (filename, content, pos, end) => {
        try {
          await projectApi.saveFile(filename, content, pos, end);
          console.log('File saved successfully');
        } catch (error) {
          console.error('Error saving file:', error);
        }
      }}
    />
  ) : (
    <FilesMapping
      key={`${filename}-${scopeKey}-${Object.keys(relatedFiles).length}`}
      data={fileData}
      filename={filename}
      projectMap={scopedProjectMap}
      onClose={() => navigate('/')}
      onRequestRelatedFile={getRelatedFile}
      onSave={async (filename, content) => {
        try {
          await projectApi.saveFile(filename, content);
          console.log('File saved successfully');
        } catch (error) {
          console.error('Error saving file:', error);
        }
      }}
    />
  );
};

const App: React.FC = () => {
  const navigate = useNavigate();

  const requestFocusedReview = useCallback(
    (source: ChangeSourceRequest, options?: FocusedReviewOptions) =>
      projectApi.getFocusedReview(source, options),
    []
  );

  const requestCommits = useCallback(
    (options?: { limit?: number; skip?: number }): Promise<CommitSummary[]> =>
      projectApi.listCommits(options),
    []
  );

  const requestReviewArrangement = useCallback(
    (entities: Entity[], relations: Relation[]) =>
      projectApi.arrangeReview(entities, relations),
    []
  );

  const [projectMap, setProjectMap] = useState<FileIncludeInfo[]>([]);
  const [filesMappings, setFilesMappings] = useState<
    Record<string, FileMapDetailed>
  >({});
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectsRootPath, setProjectsRootPath] = useState('');
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);

  console.log('App rendered', {
    activeProjectId: activeProject?.id,
    projectMap,
    filesMappings,
    projects,
  });

  const requestFileMap = useCallback(
    async (filename: string, includeRelated = false) => {
      const data = await projectApi.getFileMap(filename, includeRelated);
      const mappingsObj = lodash.keyBy(
        data.filter((fileMap) => !!fileMap.filename),
        'filename'
      ) as Record<string, FileMapDetailed>;
      setFilesMappings((filesMappings) => ({
        ...filesMappings,
        ...mappingsObj,
      }));
      return data;
    },
    []
  );

  const [forceReloadDep, setForceReloadDep] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  const applyProjectList = useCallback((projectList: ProjectListResponse) => {
    const nextProjects = projectList.projects || [];
    const nextActiveProject =
      nextProjects.find(
        (project) => project.id === projectList.activeProjectId
      ) || null;

    activeProjectIdRef.current = nextActiveProject?.id || null;
    setProjects(nextProjects);
    setProjectsRootPath(projectList.rootPath || '');
    setActiveProject(nextActiveProject);
  }, []);

  const applyOpenedProject = useCallback(
    (result: OpenProjectResponse) => {
      applyProjectList(result);
      setProjectMap(result.projectMap || []);
      setFilesMappings({});
      setForceReloadDep((i) => i + 1);
    },
    [applyProjectList]
  );

  const contextVal = useMemo(
    () => ({
      projectMap,
      filesMappings,
      forceReloadToken: forceReloadDep,
      activeProject,
    }),
    [projectMap, filesMappings, forceReloadDep, activeProject]
  );

  const [history, setHistory] = useState<any[][]>([]);
  const appendToHistory = useCallback((str: string) => {
    setHistory((hist) => [...hist, [new Date(), str]]);
  }, []);

  const openProject = useCallback(
    async (projectId: string) => {
      if (!projectId || openingProjectId === projectId) return;

      setOpeningProjectId(projectId);
      setProjectLoadError(null);

      try {
        const result = await projectApi.openProject(projectId);
        applyOpenedProject(result);
        navigate('/');
        appendToHistory(`Project opened: ${result.project.name}`);
      } catch (error: any) {
        const message = error?.message || 'Failed to open project';
        setProjectLoadError(message);
        appendToHistory(`Project open failed: ${message}`);
      } finally {
        setOpeningProjectId(null);
      }
    },
    [appendToHistory, applyOpenedProject, navigate, openingProjectId]
  );

  useEffect(() => {
    // Initialize Socket.IO connection
    const conn = initConnection(url);

    // Handle connection events
    conn.on('connect', async () => {
      console.log('APP: Connected to server');
      setConnectionStatus('connected');
      appendToHistory('Connected to server');

      // Load available projects and, for single-project mode, the active map.
      try {
        console.log('APP: Requesting projects list...');
        const projectList = await projectApi.listProjects();
        applyProjectList(projectList);

        if (projectList.activeProjectId) {
          console.log('APP: Requesting initial project map...');
          const map = await projectApi.getProjectMap();
          console.log('APP: Received project map', {
            mapType: typeof map,
            isArray: Array.isArray(map),
            length: map ? map.length : 'null/undefined',
            firstItem: map && map[0] ? Object.keys(map[0]) : 'none',
          });
          setProjectMap(map);
          console.log('APP: setProjectMap called with', {
            length: map ? map.length : 0,
          });
          appendToHistory('Project map loaded');
        } else {
          setProjectMap([]);
          setFilesMappings({});
          appendToHistory('Projects loaded');
        }
      } catch (error) {
        console.error('APP: Error loading projects:', error);
        appendToHistory('Error loading projects: ' + error);
      }
    });

    conn.on('disconnect', ({ reason }) => {
      console.log('Disconnected from server:', reason);
      setConnectionStatus('disconnected');
      appendToHistory('Disconnected: ' + reason);
    });

    conn.on('error', ({ error }) => {
      console.error('Connection error:', error);
      appendToHistory('Connection error: ' + error);
    });

    // Subscribe to project changes
    const unsubscribeProjectChange = projectApi.onProjectChange(
      async (event) => {
        const { type, path, projectId } = event as ProjectChangeEvent;
        if (
          projectId &&
          activeProjectIdRef.current &&
          projectId !== activeProjectIdRef.current
        ) {
          return;
        }

        appendToHistory(`File ${type}: ${path}`);

        // Reload project map on any file change
        try {
          const map = await projectApi.getProjectMap();
          setProjectMap(map);
          setForceReloadDep((i) => i + 1);
        } catch (error) {
          console.error('Error reloading project:', error);
        }
      }
    );

    // Subscribe to project map updates
    const unsubscribeProjectMap = projectApi.onProjectMap((data) => {
      console.log('APP: onProjectMap handler called', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      if (!activeProjectIdRef.current) return;
      appendToHistory('Project map updated');
      setProjectMap(data);
      console.log('APP: setProjectMap called from onProjectMap');
    });

    // Subscribe to file map updates
    const unsubscribeFileMap = projectApi.onFileMap((data) => {
      console.log('APP: onFileMap handler called', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      appendToHistory('File map received');
      console.log('fileMap', data);
      const mappingsObj = lodash.keyBy(data, 'filename');
      setFilesMappings((filesMappings) => ({
        ...filesMappings,
        ...mappingsObj,
      }));
    });

    const unsubscribeProjectsList = projectApi.onProjectsList((data) => {
      applyProjectList(data);
    });

    const unsubscribeActiveProjectChanged = projectApi.onActiveProjectChanged(
      (data) => {
        applyOpenedProject(data);
        appendToHistory(`Project opened: ${data.project.name}`);
      }
    );

    // Cleanup on unmount
    return () => {
      unsubscribeProjectChange();
      unsubscribeProjectMap();
      unsubscribeFileMap();
      unsubscribeProjectsList();
      unsubscribeActiveProjectChanged();
      conn.disconnect();
    };
  }, [appendToHistory, applyOpenedProject, applyProjectList]);

  return (
    <div className="App">
      {/* Connection status indicator */}
      <div className={`connection-status ${connectionStatus}`}>
        {connectionStatus === 'connecting' && 'Connecting...'}
        {connectionStatus === 'connected' && 'Connected'}
        {connectionStatus === 'disconnected' && 'Disconnected'}
      </div>

      <ProjectSwitcher
        projects={projects}
        activeProject={activeProject}
        openingProjectId={openingProjectId}
        onOpenProject={openProject}
      />

      <ProjectDataContext.Provider value={contextVal}>
        <Routes>
          <Route path="/f/:filename" element={<FileScreen />} />
          <Route path="/fine/:filename" element={<FileScreen fineGrained />} />
          <Route
            path="/"
            element={
              activeProject ? (
                <IncludesHierarchy
                  includes={projectMap}
                  filesMappings={filesMappings}
                  requestFileMap={requestFileMap}
                  requestFocusedReview={requestFocusedReview}
                  requestCommits={requestCommits}
                  requestReviewArrangement={requestReviewArrangement}
                  renderNodeMenu={(
                    filename: string,
                    anchor: HTMLElement | null,
                    onClose: () => void,
                    codeMapScope: CodeMapScope
                  ) => (
                    <Menu
                      positionAnchor={anchor}
                      options={[
                        [
                          'Logic Map',
                          () =>
                            navigate(`/fine/${encodeURIComponent(filename)}`, {
                              state: { codeMapScope },
                            }),
                        ],
                        [
                          'File Map',
                          () =>
                            navigate(`/f/${encodeURIComponent(filename)}`, {
                              state: { codeMapScope },
                            }),
                        ],
                      ]}
                      onClose={onClose}
                    />
                  )}
                />
              ) : (
                <ProjectPicker
                  projects={projects}
                  rootPath={projectsRootPath}
                  openingProjectId={openingProjectId}
                  error={projectLoadError}
                  onOpenProject={openProject}
                />
              )
            }
          />
        </Routes>
        <History history={history} />
      </ProjectDataContext.Provider>
    </div>
  );
};

function AppRoot() {
  return (
    <Router>
      <App />
    </Router>
  );
}

export default AppRoot;
