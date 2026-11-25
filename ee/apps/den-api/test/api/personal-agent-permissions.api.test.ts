import assert from "node:assert/strict"
import { after, test } from "node:test"
import { automationDetailSchema, automationRunReceiptSchema } from "@openwork/types/automations"
import { personalAgentDetailSchema, personalAgentRequestListSchema, personalAgentRequestSchema, personalAgentRunResponseSchema, personalAgentToolCatalogSchema } from "@openwork/types/den/personal-agents"
import { bootDen, field, list, startFakeHttpServer, startFakeMcpServer, summary, text } from "./harness.js"
import { gatewayFixtureEnv, grantGatewayModels, stubPublicModelCatalog } from "./gateway-fixture.js"

const restoreCatalog = stubPublicModelCatalog()
const turns: { sessionId: string; messageId: string; token: string; model: string }[] = []
const runner = await startFakeHttpServer((request, raw, response) => {
  const url = new URL(request.url ?? "/", "http://runner")
  response.setHeader("content-type", "application/json")
  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    response.writeHead(201).end(JSON.stringify({ id: `fixture-session-${turns.length + 1}` })); return
  }
  const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "")
  if (request.method === "POST" && url.pathname.endsWith("/turns")) {
    const body: unknown = JSON.parse(raw)
    turns.push({ sessionId, messageId: text(field(body, "messageId"), "message id"), token: text(field(body, "credentials", "mcpToken"), "run token"), model: text(field(body, "model"), "model") })
    response.writeHead(202).end(JSON.stringify({ state: "queued" })); return
  }
  const turn = turns.find((entry) => entry.sessionId === sessionId)
  response.end(JSON.stringify({
    turns: turn ? [{ messageId: turn.messageId, status: "completed", model: turn.model, error: null, usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 30 } }] : [],
    messages: [], finalAssistantText: "Checked the tracker.", status: "idle",
  }))
})
const tracker = await startFakeMcpServer({ tools: [
  { name: "list_issues", description: "List bug tracker issues", text: "Listed issues", annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create a bug tracker issue", text: "Created issue" },
  { name: "delete_issue", description: "Delete a bug tracker issue", text: "Deleted issue", annotations: { readOnlyHint: true, destructiveHint: true } },
] })
const den = await bootDen({ env: { ...gatewayFixtureEnv, DEN_DEPLOYMENT: "cloud", DEN_HEADLESS_RUNNER_URL: runner.url, DEN_HEADLESS_RUNNER_TOKEN: "fixture-runner-token-at-least-thirty-two-characters" } })
after(async () => { await runner.close(); await tracker.close(); await den.close(); restoreCatalog() })
const { orgId, owner: dana } = await den.createOrg(await den.signUp("Dana Reyes", "dana@acme.test"), "Permissions fixture")
const priya = await den.newMember(dana, orgId, "Priya Nair")
const sam = await den.newMember(dana, orgId, "Sam Okafor")
await grantGatewayModels(den, dana, orgId, [dana, priya, sam])
const asDana = den.as(dana, orgId)
const asPriya = den.as(priya, orgId)
const asSam = den.as(sam, orgId)
const enabled = await den.setFeature(orgId, "personalAgents", true)
assert.equal(enabled.status, 200, summary(enabled))
const connected = await asDana("POST", "/v1/mcp-connections", {
  name: "Bug tracker", url: `${tracker.url}/mcp`, authType: "none", credentialMode: "shared", access: { orgWide: true, memberIds: [], teamIds: [] },
})
assert.equal(connected.status, 200, summary(connected))
const connectionId = text(field(connected.body, "id"), "connection id")
const created = await asDana("POST", "/v1/personal-agents", { name: "Bug watcher", brief: "Check the bug tracker." })
assert.equal(created.status, 201, summary(created))
const agent = personalAgentDetailSchema.parse(created.body)
const path = `/v1/personal-agents/${agent.agent.id}`
const schedule = { kind: "daily", hour: 8, minute: 0, timezone: "UTC" }
const routine = await asDana("POST", `${path}/routines`, { name: "Morning", instructions: "Check for new issues.", schedule })
assert.equal(routine.status, 201, summary(routine))
const routineId = automationDetailSchema.parse(routine.body).automation.id
for (const [member, role] of [[priya, "collaborator"], [sam, "manager"]] as const) {
  const share = await asDana("PUT", `${path}/shares/${member.memberId}`, { role })
  assert.equal(share.status, 200, summary(share))
}

async function run(as = asPriya) {
  const before = turns.length
  const started = await as("POST", `${path}/run`, {})
  assert.equal(started.status, 202, summary(started))
  const result = personalAgentRunResponseSchema.parse(started.body)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const read = await as("GET", `${path}/runs/${result.run.id}`)
    assert.equal(read.status, 200, summary(read))
    const receipt = automationRunReceiptSchema.parse(read.body)
    if (["succeeded", "failed", "cancelled", "skipped"].includes(receipt.run.status)) return { ...result, receipt, token: turns[before]?.token }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Run did not finish")
}

async function admitted(as = asPriya) {
  const result = await run(as)
  assert.equal(result.receipt.run.status, "succeeded", JSON.stringify(result.receipt.run.error))
  assert.ok(result.token)
  return { ...result, token: result.token }
}

function execute(token: string, tool = "create_issue") {
  return den.callMcpTool(token, "execute_capability", { name: `mcp:${connectionId}:${tool}`, body: {} })
}

async function asks(token: string, tool?: string) {
  const refused = await execute(token, tool)
  assert.equal(refused.isError, true, refused.raw)
  assert.equal(field(refused.body, "error"), "needs_approval", refused.raw)
  assert.equal(field(refused.body, "retryable"), false, refused.raw)
}

async function requests(as = asPriya) {
  const res = await as("GET", `${path}/requests`)
  assert.equal(res.status, 200, summary(res))
  return personalAgentRequestListSchema.parse(res.body).items
}

function decide(as: typeof asDana, id: string, decision: string) {
  return as("POST", `${path}/requests/${id}/decision`, { decision })
}

function providerCalls() {
  return tracker.wire.filter((entry) => entry.rpcMethod === "tools/call").length
}

test("writes are listed but ask without a provider call and only one pending card is recorded", async () => {
  const { run: receipt, token } = await admitted()
  const found = await den.callMcpTool(token, "search_capabilities", { query: "bug tracker create issue", limit: 20 })
  assert.ok(list(field(found.body, "matches")).some((row) => row.name === `mcp:${connectionId}:create_issue`), found.raw)
  const catalog = personalAgentToolCatalogSchema.parse((await asPriya("GET", `${path}/tools`)).body)
  assert.deepEqual(catalog.connections[0].tools.find((tool) => tool.name === "create_issue"), { name: "create_issue", title: "create_issue", write: true, access: "ask", chosen: null, lockedByOrganization: false })
  const calls = providerCalls()
  await Promise.all([asks(token), asks(token)])
  const proxy = await den.request(token, "POST", `/mcp/agent/connections/${connectionId}`, {
    headers: { accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_capability", arguments: { name: "create_issue", body: {} } } },
  })
  assert.match(proxy.text, /needs_approval/)
  assert.equal(providerCalls(), calls)
  const rows = await requests()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].runId, receipt.id)
  assert.equal(rows[0].requestedBy.memberId, priya.memberId)
  assert.deepEqual(rows[0].canDecide, ["deny", "allow_once"])
  assert.ok((await requests(asSam))[0].canDecide.includes("always_allow"))
  const forbidden = await decide(asPriya, rows[0].id, "always_allow")
  assert.equal(forbidden.status, 403, summary(forbidden))
  assert.deepEqual(forbidden.body, { error: "personal_agent_forbidden" })
  const read = await execute(token, "list_issues")
  assert.equal(read.isError, false, read.raw)
  assert.equal(providerCalls(), calls + 1)
})

test("allow once is for the requester and applies to exactly one run; manager can always allow", async () => {
  const [waiting] = await requests()
  const once = await decide(asPriya, waiting.id, "allow_once")
  assert.equal(once.status, 200, summary(once))
  assert.equal(personalAgentRequestSchema.parse(once.body).status, "allowed_once")
  const already = await decide(asSam, waiting.id, "deny")
  assert.equal(already.status, 409, summary(already))
  const ownerRun = await admitted(asDana)
  await asks(ownerRun.token)
  const first = await admitted()
  const allowed = await execute(first.token)
  assert.equal(allowed.isError, false, allowed.raw)
  assert.equal((await requests()).find((row) => row.id === waiting.id)?.status, "used")
  const second = await admitted()
  await asks(second.token)
  const pending = (await requests()).find((row) => row.status === "pending")
  assert.ok(pending)
  const revision = second.agentRevision.version
  const permanent = await decide(asSam, pending.id, "always_allow")
  assert.equal(permanent.status, 200, summary(permanent))
  assert.equal(personalAgentRequestSchema.parse(permanent.body).status, "always_allowed")
  const later = await admitted()
  assert.equal(later.agentRevision.version, revision + 1)
  const next = await execute(later.token)
  assert.equal(next.isError, false, next.raw)
})

test("agent and organization blocks beat allowances and explicit Ask works on reads", async () => {
  await asks((await admitted()).token, "delete_issue")
  const pending = (await requests()).find((row) => row.status === "pending" && row.toolName === "delete_issue")
  assert.ok(pending)
  const once = await decide(asPriya, pending.id, "allow_once")
  assert.equal(once.status, 200, summary(once))
  const changed = await asDana("PATCH", path, { toolPolicy: { tools: { [connectionId]: { create_issue: "allow", delete_issue: "block", list_issues: "ask" } } } })
  assert.equal(changed.status, 200, summary(changed))
  const run = await admitted()
  const calls = providerCalls()
  const refused = await execute(run.token, "delete_issue")
  assert.equal(field(refused.body, "error"), "policy_blocked", refused.raw)
  assert.match(refused.raw, /delete_issue is turned off for this agent/)
  await asks(run.token, "list_issues")
  const orgBlock = await asDana("PUT", "/v1/org/personal-agent-policy", { toolPolicy: { tools: { [connectionId]: { create_issue: "block" } } } })
  assert.equal(orgBlock.status, 200, summary(orgBlock))
  const blocked = await execute((await admitted()).token)
  assert.equal(field(blocked.body, "error"), "policy_blocked", blocked.raw)
  assert.equal(providerCalls(), calls)
})

test("a collaborator can request a schedule change and a manager can approve it", async () => {
  const moved = { ...schedule, hour: 11 }
  const created = await asPriya("POST", `${path}/requests`, { summary: "Run at eleven.", change: { schedule: moved } })
  assert.equal(created.status, 201, summary(created))
  const waiting = personalAgentRequestSchema.parse(created.body)
  assert.deepEqual(waiting.canDecide, [])
  const refused = await decide(asPriya, waiting.id, "approve")
  assert.equal(refused.status, 403, summary(refused))
  const accepted = await decide(asSam, waiting.id, "approve")
  assert.equal(accepted.status, 200, summary(accepted))
  assert.equal(personalAgentRequestSchema.parse(accepted.body).status, "approved")
  const routine = await asDana("GET", `/v1/automations/${routineId}`)
  assert.deepEqual(automationDetailSchema.parse(routine.body).revision.schedule, moved)
})

test("paused and over-budget agents do not start a runner turn", async () => {
  const admin = `/v1/org/personal-agents/${agent.agent.id}`
  const before = turns.length
  const paused = await asDana("POST", `${admin}/pause`)
  assert.equal(paused.status, 200, summary(paused))
  const { admitPersonalAgentRun } = await import("../../src/personal-agents/run-admission.js")
  const { createDenTypeId } = await import("@openwork-ee/utils/typeid")
  const current = personalAgentDetailSchema.parse((await asDana("GET", path)).body)
  const admission = await admitPersonalAgentRun({ agentRevisionId: current.revision.id, runId: createDenTypeId("automationRun"), organizationId: orgId, actingMemberId: dana.memberId, headless: true })
  assert.deepEqual(admission, { ok: false, code: "execution_failed", message: "An admin paused this agent, so it did not run." })
  assert.equal(turns.length, before)
  const resumed = await asDana("POST", `${admin}/resume`)
  assert.equal(resumed.status, 200, summary(resumed))
  const budget = await asDana("PUT", `${admin}/budget`, { monthlyBudgetMicros: 0 })
  assert.equal(budget.status, 200, summary(budget))
  const failed = await run(asDana)
  assert.equal(failed.receipt.run.status, "failed")
  assert.equal(failed.receipt.run.error?.message, "This agent reached its budget for the month, so it did not run.")
  assert.equal(turns.length, before)
})

test("never matches all words ignoring case and punctuation and falls back to write tools", async () => {
  const { matchPersonalAgentNeverTools } = await import("../../src/personal-agents/never.js")
  const tools = [
    { name: "post_message", title: "Send note", write: true },
    { name: "delete_message", title: "Remove a note", write: true },
    { name: "get_message", title: "Read a message", write: false },
  ]
  assert.deepEqual(matchPersonalAgentNeverTools(tools, "MESSAGE, post!"), ["post_message"])
  assert.deepEqual(matchPersonalAgentNeverTools(tools, "read message"), ["get_message"])
  assert.deepEqual(matchPersonalAgentNeverTools(tools, "send message"), ["post_message", "delete_message"])
  assert.deepEqual(matchPersonalAgentNeverTools(tools), ["post_message", "delete_message"])
})
