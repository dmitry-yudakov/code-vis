# CodeAI MCP and an external Observer

CodeAI exposes **this machine's** projects, sessions and session actions to an external agent.
The stdio adapter connects to the running CodeAI server. CodeAI continues to own storage,
provider conversations, permissions, checkpoints, worktrees, scheduling and restart recovery.
Attached machines are excluded. The built-in text/voice Observer remains available.

Start CodeAI normally before setup. Provision a named read-only grant from the installation:

```sh
npm run mcp:grant -- "My observer"
npm run mcp:list
npm run mcp:revoke -- GRANT_UUID
```

The grant command prints a copyable `mcpServers` configuration with absolute Node, tsx loader,
script and private connection-file paths. Paste that configuration into your external MCP host.
It works with a host whose working directory is outside the checkout. It neither edits provider
configuration nor starts a model. Use the printed Node command directly; package-manager banners
must not enter MCP stdout. `npm run mcp -- CONNECTION_FILE` is also available for local debugging.
Only protocol JSON goes to adapter stdout; diagnostics go to stderr.

For an ordinary local server, the default bridge origin is `http://127.0.0.1:3023`.
Set `CODEAI_MCP_ORIGIN` (legacy spelling `CODEAI_WEB2_MCP_ORIGIN`) in the **server and setup CLI**
when using another exact loopback origin/port. HTTP is limited to `127.0.0.1`, `localhost` or `::1`.
For paired installations the bridge uses `CODEAI_PUBLIC_ORIGIN`, the existing trusted HTTPS
listener and its certificate. Install the appropriate CA trust (Node can use
`NODE_EXTRA_CA_CERTS=/absolute/path/to/ca.pem`) before starting the host. TLS verification is
never disabled; redirects, foreign Host/Origin and changed machine identities fail closed.

Grant records contain a credential digest. A separate owner-only connection file under
`<CODEAI_DATA_DIR>/integrations/mcp/` contains the actual credential and pinned origin/machine.
Keep that directory outside repository and worktree roots. Do not copy its contents into a
repository, a prompt, a URL or client configuration. The printed configuration contains its path,
never the credential. Protect the installation data directory as you protect CodeAI's session data.
Revocation prevents later operations and closes subscriptions at the next five-second heartbeat;
it preserves accepted runs. Provision a new grant after changing the pinned machine or origin.
Browser cookies and attached-machine bearers cannot authenticate this bridge, and an MCP credential
does not authorize ordinary browser/machine routes in paired mode. Existing local access remains
unchanged; this grant does not restrict the external agent's other tools.

Add the management capabilities the host needs. Session creation and messaging have separate scopes.

```sh
npm run mcp:grant -- "Session launcher" sessions:create
npm run mcp:grant -- "Session messenger" messages:send
```

Ordinary grants include `projects:read` and `sessions:read`. Add multiple scopes to one grant if the
host needs them. `sessions:create` enables `create_session`, `start_session`, and `queue_session`.
Starting or queueing includes the first message as part of creation. `messages:send` enables
`send_message` to an existing session and participant, including sessions created empty.
The server verifies the grant on dispatch and before mutations.

Reconnect the MCP host to refresh the tool list on an existing connection. Older clients can
still call `create_session` with an explicit `launch` value of `empty`, `run`, or `queue` under
their existing grant.

Open **More → Activity log** on this machine and choose **MCP** as the source to see calls from
verified grants. Each entry shows the grant, operation, outcome and any related session or message
IDs. The log also records saved changes, so a launch can show a session creation and a first
message acceptance alongside the tool call. The log keeps recent metadata in rotating local files.
The log stores metadata without prompt text or attachments.

## Queue a session in one project

On a paired HTTPS installation, the owner can provision a dedicated queue connection from the
installation terminal. Use the stable UUID of **CodeAI Dev** as `PROJECT_UUID`.

```sh
npm run mcp:grant -- "CodeAI Dev queue" --queue-project PROJECT_UUID
```

This connection advertises `list_projects` for the single granted project and `queue_session`.
Use the project's returned `bindingToken` as `expectedProjectBindings`. Set `checkoutMode` to
`current` or `worktree` and include a first message. CodeAI checks the project UUID before creating
a session or worktree.

1. Call `queue_session` with the complete request and keep both UUIDs. `confirmation_required`
   returns a review link without creating a session or worktree.
2. Open that link on a paired device. Review the project, checkout, execution, mode and exact first
   message, then select **Approve queue request**. CodeAI holds up to eight reviews per grant for
   fifteen minutes. Pending review text stays in private installation storage until submission
   or cleanup on a later request or grant revocation.
3. Send the identical `queue_session` request after confirmation. Report acceptance and the actual
   run state separately. A retained session with a rejected or uncertain first message can be retried
   with the same payload. After durable creation, exact replays use the creation receipt even after
   the review expires. Changed payloads require a new review and new request UUIDs.

Add this connection to the owner-directed MCP host separately from any briefing connection. The
queue grant limits CodeAI operations. Repository access during execution follows the machine's
provider and execution policy. Earlier conversations release the queue through the ordinary
archive flow.

## Tool reference

| Tool | Input and behavior |
| --- | --- |
| `get_workspace` | `{}` → identity, stable snapshot token, observation time, state counts and execution-specific provider/model/effort/mode choices |
| `list_projects` | Optional `cursor`, `limit` (1–50) → all local projects, including empty projects, public bindings, binding tokens and active counts |
| `list_sessions` | Optional `projectId`, `archived` (false), `cursor`, `limit` → every active session by default, including unassigned, idle, queued and failed work |
| `read_session` | `sessionId`, optional `archived` → public roster, recent authored text, revision and bounded attention excerpts with omission metadata |
| `create_session` | Create an empty session with the creation fields below |
| `start_session` | Create a session and submit its first message using normal scheduling. Requires the creation fields and `firstMessage` |
| `queue_session` | Create a session and queue its first message behind earlier conversations on overlapping checkouts. Requires the creation fields and `firstMessage` |
| `archive_session` | `sessionId`, `expectedRevision` → archive summary/revision; busy or stale sessions fail; history/worktree are retained |
| `add_participant` | `sessionId`, stable `requestId`, `provider`, `role` → one retry-idempotent participant, without changing the main agent |
| `send_message` | `sessionId`, explicit `participantId`, stable `messageId`, `text`, `mode`, optional `model`, `effort` → canonical acceptance/run state |

The creation fields are a stable `creationRequestId`, `projectId` plus
`expectedProjectBindings` or a direct `checkoutId`, `provider`, `execution`,
`checkoutMode` (`current` or `worktree`), and an optional `role`.
`firstMessage` contains `messageId`, `text`, `mode`, and optional `model` and `effort` values.
Text uses CodeAI's existing 8,000-character bound. Repository-less projects support empty
sessions. A first turn requires a primary repository. Omitted model and effort values use server
and provider defaults. Explicit choices must come from that execution's advertised health.
Tools identify repositories by checkout ID and accept only the documented fields.

Example `queue_session` arguments after reading a project's binding token and supported choices.

```json
{
  "creationRequestId": "00000000-0000-4000-8000-000000000001",
  "projectId": "00000000-0000-4000-8000-000000000002",
  "expectedProjectBindings": "COPY_THE_CURRENT_PROJECT_BINDING_TOKEN",
  "provider": "codex",
  "execution": "local",
  "checkoutMode": "current",
  "firstMessage": {
    "messageId": "00000000-0000-4000-8000-000000000003",
    "text": "Implement the agreed change and run its focused checks.",
    "mode": "agent"
  }
}
```

`start_session` may wait for execution capacity. `queue_session` also waits for earlier
conversations with saved messages on overlapping **executing checkouts** to be archived.
A fresh independent worktree is created at launch and can run immediately when capacity is available.

Keep complete requests immutable after an attempt. Creation records/journals bind the complete
launch, including empty launches; accepted messages bind recipient, text, mode and model/effort.
Reuse of an ordinary browser receipt/message ID, changed payloads or empty-to-run retries conflicts.
After a lost response, retry the exact UUIDs/payload: CodeAI reconciles saved acceptance instead of
invoking the provider twice. Partial creation returns the retained session identity and distinguishes
first-message rejection from unknown delivery. Keep its session/worktree and retry the same launch.
Archived creation replays report the archive without restoring or sending. An archive retry succeeds
only at its original resulting revision; Restore or newer work invalidates the old request.
New instructions use a new message UUID. Disconnect and MCP cancellation never cancel accepted work.
MCP metadata uses private session format 18; earlier builds leave those sessions as unsupported
newer records rather than rewriting them.

For user-directed review, add Claude as `reviewer`, send its explicit participant UUID a new Ask
message, read its findings, then send the **original Codex UUID** a new correction message in an
authorized writing mode. Each participant retains its own provider conversation and gets authored
canonical context. Adding a participant, receiving its reply or observing progress never starts
another review/correction. Autonomous peer relays remain separate future work.

The resource `codeai://local/workspace` supplies the same header as `get_workspace`. MCP
`resources/subscribe` and `resources/unsubscribe` are supported; `notifications/resources/updated`
means reread current facts. Notifications contain no transcript and are never agent instructions.
Tokens change with exposed facts or server restart, not observation timestamps/heartbeats.
Pending attention has a token over the **complete** request-ID set, including omitted summaries.
The summaries are excerpts, not permission previews. Permission decisions, run cancellation and
Build & restart remain in CodeAI's existing controls.

The private `/api/integrations/mcp` HTTP/NDJSON bridge requires the integration grant even during
ordinary local development. It is not a public Streamable HTTP MCP transport. Its limits are:

- Eight subscriptions per installation, two concurrent operations per grant; excess work is retryable busy.
- 16 KiB UTF-8 request JSON, 64 KiB response JSON, up to 50 listing rows per page, up to 16 KiB recent transcript text.
- One pinned listing per grant, eight globally, shared by project/session listing. Cursors expire in
  60 seconds and are bound to the grant and filter. Live changes never alter an in-progress listing.
  Final pages, orderly adapter shutdown, explicit internal release, expiry and revocation free the
  lease. Revoked polling-only leases are reclaimed at admission or within five seconds.
- One pending workspace invalidation per adapter. Slow readers recover current state without an
  accumulating history or a healthy-stream lifetime/output cap. Disconnect releases listeners.

A superseded/expired cursor returns `restart_listing`; restart from the first page. Busy admission
returns retryable status. An uncleanly disconnected listing has at most its remaining lease.
Subscriptions share `workspaceFeeds().executor`; attached sessions, private continuation IDs,
provider cursors, credentials, repository contents and attachment bytes do not cross this surface.
Missing/archived/unavailable detail is explicit, not an empty conversation.

An external host still needs an event loop that initiates model turns. The runnable example is:

```sh
npm run mcp:observer -- CONNECTION_FILE /absolute/path/to/briefing-agent ARGUMENTS
```

The supplied executable reads one JSON request on stdin and writes its user-facing reply on stdout.
Use your existing model host or CLI, which retains ownership of its model, history and conversation.
The example keeps subscription reading independent from inference, coalesces changes during a turn,
polls the header every five seconds as a fallback, and invokes inference only for new attention,
failures or `/brief`. Ordinary progress stays quiet; completions enter requested briefings. It tracks
revision/run/attention identities so unchanged conditions do not repeat. It treats session text as
untrusted evidence and gives its inference command no management callback.

Type `/brief` for a briefing. To explicitly direct a management action, type
`/tool {"name":"TOOL_NAME","arguments":{...}}` with reviewed arguments. Tool output is returned to
that same terminal conversation. The example never derives management requests from session text.
Ctrl+C stops only the observer. After failure it reports unavailable/last-observed state, reconnects
with backoff capped at 30 seconds and rereads facts. This is a current-state feed, not a durable event
log; intermediate transitions may have been missed. CodeAI work continues if the host stops.

Verified transport: official TypeScript SDK **1.32.2**, SDK Client/Server stdio negotiation
**2025-11-25**; that SDK additionally accepts 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07.
Resource subscriptions and polling are exercised with the SDK host. Do not assume a client's MCP
connection starts autonomous observation or that every client implements resource subscriptions.
