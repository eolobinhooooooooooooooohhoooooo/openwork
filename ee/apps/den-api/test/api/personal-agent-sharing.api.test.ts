import assert from "node:assert/strict"
import { after, test } from "node:test"
import { eq } from "@openwork-ee/den-db/drizzle"
import { AutomationRunTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { automationDetailSchema, automationRunReceiptSchema } from "@openwork/types/automations"
import {
  personalAgentChatResponseSchema,
  personalAgentDetailSchema,
  personalAgentListSchema,
  personalAgentRoutineListSchema,
  personalAgentRunListSchema,
  personalAgentRunResponseSchema,
  personalAgentShareListSchema,
} from "@openwork/types/den/personal-agents"
import { bootDen, field, startFakeHttpServer, startFakeMcpServer, summary, text } from "./harness.js"
import { gatewayFixtureEnv, grantGatewayModels, stubPublicModelCatalog } from "./gateway-fixture.js"

const restoreCatalog = stubPublicModelCatalog()
const turns = new Map<string, { messageId: string; model: string; mcpToken: string }>()
let sessionCount = 0
const runner = await startFakeHttpServer((request, raw, response) => {
  const url = new URL(request.url ?? "/", "http://runner")
  response.setHeader("content-type", "application/json")
  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    response.writeHead(201).end(JSON.stringify({ id: `fixture-session-${++sessionCount}` }))
    return
  }
  const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "")
  if (request.method === "POST" && url.pathname.endsWith("/turns")) {
    const body: unknown = JSON.parse(raw)
    turns.set(sessionId, {
      messageId: text(field(body, "messageId"), "message id"),
      model: text(field(body, "model"), "model"),
      mcpToken: text(field(body, "credentials", "mcpToken"), "run credential"),
    })
    response.writeHead(202).end(JSON.stringify({ state: "queued" }))
    return
  }
  const turn = turns.get(sessionId)
  const answer = "Found one report."
  response.end(JSON.stringify({
    turns: turn ? [{ messageId: turn.messageId, status: "completed", model: turn.model, error: null, usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 30 } }] : [],
    messages: turn ? [{ role: "assistant", text: answer, toolCalls: [] }] : [],
    finalAssistantText: turn ? answer : "",
    status: "idle",
  }))
})
const tracker = await startFakeMcpServer({ tools: [
  { name: "list_bug_reports", description: "List bug reports", text: "One report", annotations: { readOnlyHint: true, destructiveHint: false } },
] })
const den = await bootDen({ env: {
  ...gatewayFixtureEnv,
  DEN_DEPLOYMENT: "cloud",
  DEN_HEADLESS_RUNNER_URL: runner.url,
  DEN_HEADLESS_RUNNER_TOKEN: "fixture-runner-token-at-least-thirty-two-characters",
} })
after(async () => { await runner.close(); await tracker.close(); await den.close(); restoreCatalog() })

const { orgId, owner: dana } = await den.createOrg(await den.signUp("Dana Reyes"), "Sharing fixture")
const sam = await den.newMember(dana, orgId, "Sam Okafor")
const priya = await den.newMember(dana, orgId, "Priya Nair")
const lee = await den.newMember(dana, orgId, "Lee Park", "admin")
const { db } = await import("../../src/db.js")
const { listPersonalAgentEvents } = await import("../../src/personal-agents/events.js")
await grantGatewayModels(den, dana, orgId, [dana, priya])
const asDana = den.as(dana, orgId)
const asSam = den.as(sam, orgId)
const asPriya = den.as(priya, orgId)
const asLee = den.as(lee, orgId)
const root = "/v1/personal-agents"
const schedule = { kind: "daily", hour: 8, minute: 0, timezone: "UTC" }
const routineInput = { name: "Morning sweep", instructions: "Check the tracker.", schedule }
const definition = { name: "Bug watcher", brief: "Summarize new bug reports.", idempotencyKey: "fixture-bug-watcher" }

async function expectStatus(request: ReturnType<typeof asDana>, status: number) {
  const response = await request
  assert.equal(response.status, status, summary(response))
  return response.body
}

const sharingPaths = (path: string) => [
  ["GET", `${path}/shares`, undefined],
  ["PUT", `${path}/shares/${priya.memberId}`, { role: "collaborator" }],
  ["DELETE", `${path}/shares/${priya.memberId}`, undefined],
  ["GET", `${path}/chat?workspaceId=work`, undefined],
  ["PUT", `${path}/chat`, { workspaceId: "work", sessionId: "fixture-chat" }],
  ["PATCH", `${path}/routines/missing`, { active: false }],
  ["GET", `${path}/runs`, undefined],
  ["GET", `${path}/runs/missing`, undefined],
] as const

let agentId = ""
let path = ""
let routineId = ""

test("all new routes are hidden when personal agents are off", async () => {
  for (const [method, url, body] of sharingPaths(`${root}/missing`)) {
    assert.deepEqual(await expectStatus(asDana(method, url, body), 404), { error: "feature_disabled", feature: "personalAgents" })
  }
  await expectStatus(den.setFeature(orgId, "personalAgents", true), 200)
})

test("concurrent creates replay a single agent, with conflicts based on its original name and brief", async () => {
  const created = await Promise.all([asDana("POST", root, definition), asDana("POST", root, definition)])
  const [first, second] = created.map((response) => {
    assert.equal(response.status, 201, summary(response))
    return personalAgentDetailSchema.parse(response.body)
  })
  agentId = first.agent.id
  path = `${root}/${agentId}`
  assert.equal(second.agent.id, agentId)
  assert.deepEqual(first.owner, { memberId: dana.memberId, name: "Dana Reyes" })
  assert.equal(first.role, "owner")
  assert.equal(personalAgentListSchema.parse(await expectStatus(asDana("GET", root), 200)).items.length, 1)
  await expectStatus(asDana("PATCH", path, { name: "Bug triage", brief: "Read the new reports.", monthlyBudgetMicros: 1000 }), 200)
  assert.equal(personalAgentDetailSchema.parse(await expectStatus(asDana("POST", root, definition), 201)).agent.id, agentId)
  for (const change of [{ name: "Bug triage" }, { brief: "Read the new reports." }]) {
    assert.deepEqual(await expectStatus(asDana("POST", root, { ...definition, ...change }), 409), { error: "personal_agent_idempotency_conflict" })
  }
  const samAgent = personalAgentDetailSchema.parse(await expectStatus(asSam("POST", root, definition), 201))
  assert.notEqual(samAgent.agent.id, agentId)
})

test("owners, managers and collaborators have different rights, and unshared members see nothing", async () => {
  for (const [method, url, body] of sharingPaths(path)) await expectStatus(asLee(method, url, body), 404)
  await expectStatus(asLee("GET", path), 404)
  assert.deepEqual(personalAgentListSchema.parse(await expectStatus(asLee("GET", root), 200)).items, [])
  await expectStatus(asDana("PUT", `${path}/shares/${dana.memberId}`, { role: "manager" }), 403)
  await expectStatus(asDana("PUT", `${path}/shares/${sam.memberId}`, { role: "manager" }), 200)
  await expectStatus(asSam("PUT", `${path}/shares/${priya.memberId}`, { role: "manager" }), 403)
  await expectStatus(asSam("PUT", `${path}/shares/${sam.memberId}`, { role: "collaborator" }), 403)
  await expectStatus(asSam("PUT", `${path}/shares/${priya.memberId}`, { role: "collaborator" }), 200)
  const shares = personalAgentShareListSchema.parse(await expectStatus(asPriya("GET", `${path}/shares`), 200))
  assert.deepEqual(shares.items.map(({ name, role }) => ({ name, role })), [{ name: "Sam Okafor", role: "manager" }, { name: "Priya Nair", role: "collaborator" }])
  const mine = personalAgentListSchema.parse(await expectStatus(asPriya("GET", root), 200)).items[0]
  assert.equal(mine?.agent.id, agentId)
  assert.equal(mine?.owner?.name, "Dana Reyes")
  assert.equal(mine?.role, "collaborator")
  const updated = personalAgentDetailSchema.parse(await expectStatus(asSam("PATCH", path, { brief: "Read only the latest reports." }), 200))
  assert.equal(updated.role, "manager")
  assert.equal(updated.revision.brief, "Read only the latest reports.")
  for (const body of [{ monthlyBudgetMicros: null }, { defaultExecutionTarget: "desktop" }]) await expectStatus(asSam("PATCH", path, body), 403)
  await expectStatus(asSam("DELETE", path), 403)
  const routine = automationDetailSchema.parse(await expectStatus(asDana("POST", `${path}/routines`, routineInput), 201))
  routineId = routine.automation.id
  const routinePath = `${path}/routines/${routineId}`
  const changed = automationDetailSchema.parse(await expectStatus(asSam("PATCH", routinePath, { name: "Evening sweep", active: false, schedule: { ...schedule, hour: 18 }, instructions: "Read the latest bugs." }), 200))
  assert.equal(changed.automation.state, "inactive")
  assert.equal(changed.revision.instructions, "Read the latest bugs.")
  const activated = automationDetailSchema.parse(await expectStatus(asSam("PATCH", routinePath, { active: true }), 200))
  assert.equal(activated.automation.state, "active")
  const shared = personalAgentDetailSchema.parse(await expectStatus(asPriya("GET", path), 200))
  assert.equal(shared.role, "collaborator")
  assert.deepEqual(shared.routines.map(({ id, name, schedule }) => ({ id, name, schedule })), [{ id: routineId, name: "Evening sweep", schedule: { ...schedule, hour: 18 } }])
  assert.equal(personalAgentRoutineListSchema.parse(await expectStatus(asPriya("GET", `${path}/routines`), 200)).items[0]?.automation.id, routineId)
  for (const [method, url, body] of [
    ["PATCH", path, { brief: "Another brief." }],
    ["PATCH", routinePath, { active: false }],
    ["POST", `${path}/routines`, routineInput],
    ["PUT", `${path}/shares/${lee.memberId}`, { role: "collaborator" }],
    ["DELETE", `${path}/shares/${sam.memberId}`, undefined],
  ] as const) {
    const refusal = await expectStatus(asPriya(method, url, body), 403)
    assert.equal(field(refusal, "error"), "personal_agent_forbidden")
    assert.match(text(field(refusal, "message"), "refusal"), /\.$/)
  }
})

test("chat pointers belong to a member and workspace", async () => {
  const chat = `${path}/chat`
  assert.deepEqual(await expectStatus(asDana("GET", `${chat}?workspaceId=work`), 200), { chat: null })
  const saved = personalAgentChatResponseSchema.parse(await expectStatus(asPriya("PUT", chat, { workspaceId: "work", sessionId: "priya-work" }), 200))
  await expectStatus(asDana("PUT", chat, { workspaceId: "work", sessionId: "dana-work" }), 200)
  await expectStatus(asPriya("PUT", chat, { workspaceId: "home", sessionId: "priya-home" }), 200)
  assert.deepEqual(personalAgentChatResponseSchema.parse(await expectStatus(asPriya("GET", `${chat}?workspaceId=work`), 200)), saved)
  assert.equal(field(await expectStatus(asDana("GET", `${chat}?workspaceId=work`), 200), "chat", "sessionId"), "dana-work")
  assert.equal(field(await expectStatus(asPriya("GET", `${chat}?workspaceId=home`), 200), "chat", "sessionId"), "priya-home")
  await expectStatus(asPriya("PUT", chat, { workspaceId: "work", sessionId: "priya-new-work" }), 200)
  assert.equal(field(await expectStatus(asPriya("GET", `${chat}?workspaceId=work`), 200), "chat", "sessionId"), "priya-new-work")
})

async function settled(api: typeof asDana, runPath: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = automationRunReceiptSchema.parse(await expectStatus(api("GET", runPath), 200))
    if (receipt.run.finishedAt !== null) return receipt
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("The run did not finish")
}

test("a collaborator's run uses their own credential and is invisible to the owner", async () => {
  const connection = await expectStatus(asDana("POST", "/v1/mcp-connections", {
    name: "Priya's tracker", url: `${tracker.url}/mcp`, authType: "none", credentialMode: "shared",
    access: { orgWide: false, memberIds: [priya.memberId], teamIds: [] },
  }), 200)
  const connector = text(field(connection, "id"), "connection id")
  const started = await expectStatus(asPriya("POST", `${path}/run`, { routineId }), 202)
  const { run } = personalAgentRunResponseSchema.parse(started)
  assert.equal(field(started, "run", "actingMemberId"), undefined)
  const [row] = await db.$primary.select({ actingMemberId: AutomationRunTable.acting_member_id }).from(AutomationRunTable).where(eq(AutomationRunTable.id, normalizeDenTypeId("automationRun", run.id))).limit(1)
  assert.equal(row?.actingMemberId, priya.memberId)
  const runPath = `${path}/runs/${run.id}`
  const receipt = await settled(asPriya, runPath)
  assert.equal(receipt.run.status, "succeeded", JSON.stringify(receipt.run.error))
  const turn = Array.from(turns.values()).at(-1)
  assert.ok(turn)
  const capability = { name: `mcp:${connector}:list_bug_reports`, body: {} }
  const refused = await den.callMcpTool(await den.mintMcpToken(dana, orgId), "execute_capability", capability)
  assert.equal(refused.isError, true, refused.raw)
  const allowed = await den.callMcpTool(turn.mcpToken, "execute_capability", capability)
  assert.equal(allowed.isError, false, allowed.raw)
  await expectStatus(asDana("GET", runPath), 404)
  await expectStatus(asSam("GET", runPath), 404)
  await expectStatus(asDana("GET", `/v1/automation-runs/${run.id}`), 404)
  const list = (request: ReturnType<typeof asDana>) => expectStatus(request, 200).then((body) => personalAgentRunListSchema.parse(body).items.map(({ id }) => id))
  assert.deepEqual(await list(asDana("GET", `${path}/runs`)), [])
  assert.deepEqual(await list(asPriya("GET", `${path}/runs?limit=1`)), [run.id])
  assert.equal(personalAgentDetailSchema.parse(await expectStatus(asPriya("GET", path), 200)).routines[0]?.latestRun?.id, run.id)
  assert.equal(personalAgentDetailSchema.parse(await expectStatus(asDana("GET", path), 200)).routines[0]?.latestRun, null)
  const ownerRun = personalAgentRunResponseSchema.parse(await expectStatus(asDana("POST", `${path}/run`, { routineId }), 202)).run
  await expectStatus(asPriya("GET", `${path}/runs/${ownerRun.id}`), 404)
  assert.deepEqual(await list(asDana("GET", `${path}/runs`)), [ownerRun.id])
  assert.deepEqual(await list(asPriya("GET", `${path}/runs`)), [run.id])
  assert.equal((await settled(asDana, `${path}/runs/${ownerRun.id}`)).run.status, "succeeded")
})

test("share changes and removal are recorded without storing a brief or instructions", async () => {
  await expectStatus(asDana("PUT", `${path}/shares/${priya.memberId}`, { role: "manager" }), 200)
  await expectStatus(asSam("DELETE", `${path}/shares/${priya.memberId}`), 403)
  await expectStatus(asPriya("DELETE", `${path}/shares/${priya.memberId}`), 200)
  await expectStatus(asPriya("GET", path), 404)
  await expectStatus(asDana("DELETE", `${path}/shares/${sam.memberId}`), 200)
  await expectStatus(asDana("DELETE", path), 200)
  const events = await listPersonalAgentEvents({ organizationId: orgId, agentId, limit: 50 })
  assert.deepEqual(events.filter((event) => event.action.startsWith("share.")).reverse().map(({ action, detail }) => [action, detail]), [
    ["share.added", { memberName: "Sam Okafor", role: "manager" }],
    ["share.added", { memberName: "Priya Nair", role: "collaborator" }],
    ["share.changed", { memberName: "Priya Nair", role: "manager" }],
    ["share.removed", { memberName: "Priya Nair", role: "manager" }],
    ["share.removed", { memberName: "Sam Okafor", role: "manager" }],
  ])
  assert.equal(events.filter((event) => event.action === "agent.created").length, 1)
  assert.ok(events.some((event) => event.action === "agent.archived"))
  assert.ok(events.some((event) => event.action === "routine.created"))
  assert.ok(events.some((event) => event.action === "routine.changed" && event.detail.instructions === true))
  assert.equal(JSON.stringify(events).includes("Read only the latest reports."), false)
  assert.equal(JSON.stringify(events).includes("Read the latest bugs."), false)
})
