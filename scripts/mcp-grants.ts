import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import { getConfig } from '../src/server/config';
import { listGrants, provisionGrant, revokeGrant } from '../src/server/integrations/mcp/grants';
import { mcpScopeSchema } from '../src/shared/mcp';
async function main() {
  loadEnvConfig(process.cwd());
  const config = getConfig(); const [action, value, ...rawScopes] = process.argv.slice(2);
  if (action === 'grant' && value) {
    const queueProjectId = rawScopes[0] === '--queue-project' && rawScopes.length === 2 ? rawScopes[1] : undefined;
    const scopes = queueProjectId === undefined ? rawScopes.map(scope => mcpScopeSchema.parse(scope)) : [];
    const { grant, connectionPath } = await provisionGrant(config, value, scopes, queueProjectId);
    process.stdout.write(`Grant ${grant.id} (${grant.name})\nScopes: ${grant.scopes.join(', ')}\nClient configuration:\n${JSON.stringify({ mcpServers: { codeai: {
      command: process.execPath, args: ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('scripts/mcp.ts'), connectionPath],
    } } }, null, 2)}\n`);
  } else if (action === 'revoke' && value) {
    await revokeGrant(config, value); process.stdout.write('MCP grant revoked. Active subscriptions close by the next five-second heartbeat.\n');
  } else if (action === 'list') {
    for (const grant of await listGrants(config)) process.stdout.write(`${grant.id}\t${grant.name}\t${grant.scopes.join(', ')}${grant.queueProjectId ? `\t${grant.queueProjectId}` : ''}\n`);
  } else throw new Error('Use mcp:grant -- NAME [SCOPES... | --queue-project PROJECT_UUID], mcp:revoke -- GRANT_ID, or mcp:list.');
}
main().catch(error => { process.stderr.write(`CodeAI MCP setup: ${error instanceof Error ? error.message : 'Failed.'}\n`); process.exitCode = 1; });
