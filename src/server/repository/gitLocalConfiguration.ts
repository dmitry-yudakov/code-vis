/** Shared allowlist for host Git mutations after inspecting worker-writable local configuration.
 * Command-running and path-redirection keys are refused; each caller disables hooks explicitly. */
const ALLOWED_LOCAL_KEY = new RegExp(`^(?:${[
  'core\\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|hookspath)',
  'user\\.(?:name|email|signingkey)', 'commit\\.gpgsign', 'pull\\.(?:rebase|ff)', 'fetch\\.prune', 'rerere\\.enabled',
  'remote\\.pushdefault', 'remote\\..+\\.(?:url|pushurl|fetch|tagopt|prune|gh-resolved)', 'branch\\..+\\.[^.]+', 'submodule\\..+\\.(?:url|active)',
].join('|')})$`, 's');
const DESKTOP_PREFERENCES = new Set(['gitg.mainline', 'taggrouping.groups', 'taggrouping.singles']);

export type GitConfiguration = Map<string, string[]>;

export function configuration(output: string): GitConfiguration {
  const config: GitConfiguration = new Map();
  for (const entry of output.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\n');
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const values = config.get(key) || [];
    values.push(separator === -1 ? '' : entry.slice(separator + 1));
    config.set(key, values);
  }
  return config;
}

export function unsupportedLocalGitKey(config: GitConfiguration, { allowDesktopPreferences = false } = {}): string | undefined {
  return [...config.keys()].find(key => !ALLOWED_LOCAL_KEY.test(key)
    && !(allowDesktopPreferences && DESKTOP_PREFERENCES.has(key)));
}
