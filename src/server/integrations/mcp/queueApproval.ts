import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { atomicWrite } from '@/server/storage/atomicWrite';
import { inspectSessionCreation, projectBindingsFingerprint, withSessionCreationLock } from '@/server/storage/creationRequests';
import { getSessionStore, primaryRepository } from '@/server/storage/sessionStore';
import { mcpQueueSessionSchema, type McpQueueReview, type McpQueueSession } from '@/shared/mcp';
import { mcpCreationRequest } from './actions';
import { digest, McpError, readGrant, type McpGrant } from './grants';

const approvalTtlMs = 15 * 60_000;
const maxProposals = 8;
const proposalSchema = z.object({ request: mcpQueueSessionSchema, approved: z.boolean(), expiresAt: z.number() }).strict();
const proposalsSchema = z.array(proposalSchema).max(maxProposals);

function proposalFile(config: AppConfig, grantId: string) {
  return path.join(config.dataDir, 'integrations', 'mcp', `${grantId}.queue.json`);
}

async function proposals(config: AppConfig, grantId: string) {
  const raw = await readFile(proposalFile(config, grantId), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  });
  return proposalsSchema.parse(JSON.parse(raw)).filter(proposal => proposal.expiresAt > Date.now());
}

export function scopedQueueRequest(config: AppConfig, grant: McpGrant, input: unknown) {
  const parsed = mcpQueueSessionSchema.safeParse(input);
  if (config.remoteAccess !== 'paired' || !parsed.success || parsed.data.projectId !== grant.queueProjectId) {
    throw new McpError('forbidden', 'This grant can only queue a first message in its configured project.', 403);
  }
  return parsed.data;
}

export async function queueProject(config: AppConfig, grant: McpGrant) {
  if (!grant.queueProjectId) throw new McpError('forbidden', 'A project queue grant is required.', 403);
  const store = getSessionStore(config.dataDir, config.hostLabel);
  const project = await store.getProject(grant.queueProjectId);
  return { id: project.id, name: project.name, bindingToken: projectBindingsFingerprint(project), repositories: project.repositories };
}

async function reviewBinding(config: AppConfig, grant: McpGrant, request: McpQueueSession) {
  const project = await queueProject(config, grant);
  const primary = primaryRepository(project);
  if (project.bindingToken !== request.expectedProjectBindings || !primary || primary.hostId !== grant.machineId) {
    throw new McpError('conflict', 'The project needs the same local primary checkout as in the prepared request.', 409);
  }
  return { projectName: project.name, checkoutId: primary.checkoutId };
}

/** Return a review link until approval or a matching durable creation intent authorizes launch. */
export async function queueReviewUrl(config: AppConfig, grant: McpGrant, request: McpQueueSession, authorize: () => Promise<void>) {
  return withSessionCreationLock(config.dataDir, async () => {
    if (await inspectSessionCreation(mcpCreationRequest(request, grant.id), config)) return undefined;
    const records = await proposals(config, grant.id);
    const prior = records.find(proposal => proposal.request.creationRequestId === request.creationRequestId);
    if (prior && digest(prior.request) !== digest(request)) {
      throw new McpError('conflict', 'Creation request id was already used with different choices.', 409);
    }
    if (prior?.approved || !prior) await reviewBinding(config, grant, request);
    if (prior?.approved) return undefined;
    if (!prior) {
      if (records.length >= maxProposals) throw new McpError('busy', 'Eight queue reviews are pending for this grant. Retry after a review expires.', 429, true);
      records.push({ request, approved: false, expiresAt: Date.now() + approvalTtlMs });
      await atomicWrite(proposalFile(config, grant.id), records, authorize);
    }
    return `${grant.origin}/mcp/queue/${grant.id}/${request.creationRequestId}`;
  });
}

export async function releaseQueueReview(config: AppConfig, grantId: string, requestId: string) {
  await withSessionCreationLock(config.dataDir, async () => {
    const records = await proposals(config, grantId);
    const remaining = records.filter(proposal => proposal.request.creationRequestId !== requestId);
    if (remaining.length !== records.length) await atomicWrite(proposalFile(config, grantId), remaining);
  });
}

export async function readQueueReview(config: AppConfig, grantId: string, requestId: string,
  approval?: { fingerprint: string; authorize(): Promise<void> }): Promise<McpQueueReview> {
  const read = async () => {
    const grant = await readGrant(config, grantId).catch(() => undefined);
    if (!grant?.queueProjectId || grant.origin !== config.publicOrigin ||
        grant.machineId !== (await getSessionStore(config.dataDir, config.hostLabel).host()).id) {
      throw new McpError('missing', 'Queue review is no longer available.', 404);
    }
    const records = await proposals(config, grant.id);
    const proposal = records.find(record => record.request.creationRequestId === requestId);
    if (!proposal) throw new McpError('missing', 'Queue review expired or was already submitted.', 404);
    const request = scopedQueueRequest(config, grant, proposal.request);
    const binding = await reviewBinding(config, grant, request);
    const fingerprint = digest(request);
    if (approval) {
      if (approval.fingerprint !== fingerprint) throw new McpError('conflict', 'Queue request changed. Open the review again.', 409);
      if (!proposal.approved) {
        proposal.approved = true;
        await atomicWrite(proposalFile(config, grant.id), records, approval.authorize);
      }
    }
    return { ...binding, request, grantName: grant.name, fingerprint, approved: proposal.approved };
  };
  const review = await (approval ? withSessionCreationLock(config.dataDir, read) : read());
  const checkouts = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).refresh().catch(() => []);
  return { ...review, checkoutName: checkouts.find(checkout => checkout.id === review.checkoutId)?.name };
}
