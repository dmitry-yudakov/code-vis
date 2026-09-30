import os from 'node:os';
import path from 'node:path';

// The developer's own global instructions must not change any result: a local Claude turn would
// otherwise pass ~/.claude/CLAUDE.md to the fake CLI. A suite about them names its own folders.
process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'codeai-test-no-claude-home');
process.env.CODEX_HOME = path.join(os.tmpdir(), 'codeai-test-no-codex-home');
