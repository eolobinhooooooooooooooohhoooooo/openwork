import assert from "node:assert/strict"
import { after, test } from "node:test"
import { automationDetailSchema } from "@openwork/types/automations"
import {
  personalAgentAdminItemSchema,
  personalAgentAdminListSchema,
  personalAgentDetailSchema,
  personalAgentEventListSchema,
  personalAgentListSchema,
  personalAgentOrgPolicySchema,
} from "@openwork/types/den/personal-agents"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { gatewayFixtureEnv, grantGatewayModels, stubPublicModelCatalog } from "./gateway-fixture.js"
import { bootDen, field, startFakeHttpServer, startFakeMcpServer, summary, text } from "./harness.js"

const restoreCatalog = stubPublicModelCatalog()
const runner = await startFakeHttpServer((_request, _raw, response) => response.writeHead(404).end())
const tracker = await startFakeMcpServer({ tools: [{ name: "create_issue", description: "File an issue", text: "Issue filed" }] })
const den = await bootDen({ env: {
  ...gatewayFixtureEnv,
  DEN_DEPLOYMENT: "cloud",
  DEN_HEADLESS_RUNNER_URL: runner.url,
  DEN_HEADLESS_RUNNER_TOKEN: "fixture-runner-token-at-least-thirty-two-characters",
} })
after(async () => { await runner.close(); await tracker.close(); await den.close(); restoreCatalog() })

const { orgId, owner: dana } = await den.createOrg(await den.signUp("Dana Reyes", "dana-reyes@acme.test"), "Personal agents admin fixture")
const lee = await den.newMember(dana, orgId, "Lee Park", "admin")
const sam = await den.newMember(dana, orgId, "Sam Okafor")
const asDana = den.as(dana, orgId)
const asLee = den.as(lee, orgId)
const asSam = den.as(sam, orgId)
const agents = "/v1/org/personal-agents"
const policyPath = "/v1/org/personal-agent-policy"
const eventsPath = "/v1/org/personal-agent-events"
const brief = "Private instructions to collect the morning bug reports."
const emptyPolicy = { toolPolicy: { connections: {}, tools: {} }, monthlyBudgetMicros: null }

function agentRoutes(id: string) {
  return [
    ["POST", `${agents}/${id}/pause`, undefined],
    ["POST", `${agents}/${id}/resume`, undefined],
    ["PUT", `${agents}/${id}/budget`, { monthlyBudgetMicros: 1 }],
    ["POST", `${agents}/${id}/transfer`, { memberId: sam.memberId }],
    ["POST", `${agents}/${id}/archive`, undefined],
  ] as const
}

const routes = [
  ["GET", agents, undefined],
  ...agentRoutes(createDenTypeId("personalAgent")),
  ["GET", policyPath, undefined],
  ["PUT", policyPath, { monthlyBudgetMicros: 1 }],
  ["GET", eventsPath, undefined],
] as const

test("all nine admin routes honor the feature flag and require admin access", async () => {
  for (const [method, path, body] of routes) {
    const result = await asLee(method, path, body)
    assert.equal(result.status, 404, summary(result))
    assert.deepEqual(result.body, { error: "feature_disabled", feature: "personalAgents" })
  }
  assert.equal((await den.setFeature(orgId, "personalAgents", true)).status, 200)
  for (const [method, path, body] of routes) {
    const result = await asSam(method, path, body)
    assert.equal(result.status, 403, `${method} ${path}: ${summary(result)}`)
  }
  const ownerRead = await asDana("GET", policyPath)
  assert.equal(ownerRead.status, 200, summary(ownerRead))
  assert.deepEqual(ownerRead.body, emptyPolicy)
})

test("admins can manage agents across owners without getting their briefs", async () => {
  await grantGatewayModels(den, dana, orgId, [dana, sam])
  const connected = await asDana("POST", "/v1/mcp-connections", {
    name: "Bug tracker", url: `${tracker.url}/mcp`, authType: "none", credentialMode: "shared", access: { orgWide: true, memberIds: [], teamIds: [] },
  })
  assert.equal(connected.status, 200, summary(connected))
  const connectionId = text(field(connected.body, "id"), "connection id")
  const created = await asDana("POST", "/v1/personal-agents", {
    name: "Bug watcher", brief,
    toolPolicy: { tools: { [connectionId]: { create_issue: "allow", update_issue: "ask", delete_issue: "block" } } },
  })
  assert.equal(created.status, 201, summary(created))
  const { agent: { id } } = personalAgentDetailSchema.parse(created.body)
  const adminAgent = `${agents}/${id}`
  const memberAgent = `/v1/personal-agents/${id}`
  const samAgentCreated = await asSam("POST", "/v1/personal-agents", {
    name: "Bug reporter", brief: "Private instructions for Sam's agent.", toolPolicy: { connections: { [connectionId]: "block" } },
  })
  assert.equal(samAgentCreated.status, 201, summary(samAgentCreated))
  const samAgent = personalAgentDetailSchema.parse(samAgentCreated.body).agent
  const share = await asDana("PUT", `${memberAgent}/shares/${sam.memberId}`, { role: "manager" })
  assert.equal(share.status, 200, summary(share))
  const routineCreated = await asDana("POST", `${memberAgent}/routines`, {
    name: "Morning bugs", instructions: "Collect yesterday's reports.", schedule: { kind: "daily", hour: 8, minute: 0, timezone: "UTC" },
  })
  assert.equal(routineCreated.status, 201, summary(routineCreated))
  const routine = automationDetailSchema.parse(routineCreated.body).automation
  const adminList = await asLee("GET", agents)
  assert.equal(adminList.status, 200, summary(adminList))
  assert.doesNotMatch(adminList.text, /"brief"|Private instructions/)
  const listed = personalAgentAdminListSchema.parse(adminList.body)
  assert.deepEqual(listed.policy, emptyPolicy)
  assert.deepEqual(listed.items.map((entry) => [entry.agent.id, entry.owner.name]), [[samAgent.id, sam.name], [id, dana.name]])
  const danaItem = listed.items.find((item) => item.agent.id === id)
  assert.ok(danaItem)
  assert.deepEqual(danaItem.sharedWith.map((person) => [person.name, person.role]), [[sam.name, "manager"]])
  assert.deepEqual(danaItem.writeAccess, { allowed: 1, ask: 1, blocked: 1 })
  assert.deepEqual(listed.items[0]?.writeAccess, { allowed: 0, ask: 0, blocked: 1 })
  assert.deepEqual(danaItem.routines.map((entry) => entry.id), [routine.id])
  assert.equal(listed.monthMicros, listed.items.reduce((total, item) => total + item.spend.monthMicros, 0))

  const paused = await asLee("POST", `${adminAgent}/pause`)
  assert.equal(paused.status, 200, summary(paused))
  const pausedAt = personalAgentAdminItemSchema.parse(paused.body).agent.pausedAt
  assert.ok(pausedAt)
  const whilePaused = await asDana("GET", memberAgent)
  assert.equal(whilePaused.status, 200, summary(whilePaused))
  assert.equal(personalAgentDetailSchema.parse(whilePaused.body).agent.pausedAt, pausedAt)
  const pausedAgain = await asLee("POST", `${adminAgent}/pause`)
  assert.equal(pausedAgain.status, 200, summary(pausedAgain))
  assert.deepEqual(pausedAgain.body, paused.body)
  const resumed = await asLee("POST", `${adminAgent}/resume`)
  assert.equal(resumed.status, 200, summary(resumed))
  assert.equal(personalAgentAdminItemSchema.parse(resumed.body).agent.pausedAt, null)
  const whileResumed = await asDana("GET", memberAgent)
  assert.equal(whileResumed.status, 200, summary(whileResumed))
  assert.equal(personalAgentDetailSchema.parse(whileResumed.body).agent.pausedAt, null)
  const resumedAgain = await asLee("POST", `${adminAgent}/resume`)
  assert.equal(resumedAgain.status, 200, summary(resumedAgain))
  assert.deepEqual(resumedAgain.body, resumed.body)

  const budget = await asLee("PUT", `${adminAgent}/budget`, { monthlyBudgetMicros: 100_000 })
  assert.equal(budget.status, 200, summary(budget))
  assert.equal(personalAgentAdminItemSchema.parse(budget.body).spend.adminBudgetMicros, 100_000)

  const { orgId: otherOrgId, owner: priya } = await den.createOrg(await den.signUp("Priya Nair", "priya-nair@acme.test"), "Other organization admin fixture")
  const otherLee = await den.join(priya, otherOrgId, lee, "admin")
  const asOtherAdmin = den.as(otherLee, otherOrgId)
  assert.equal((await den.setFeature(otherOrgId, "personalAgents", true)).status, 200)
  for (const [invoke, invalidId] of [[asLee, "malformed"], [asOtherAdmin, id]] as const) {
    for (const [method, path, body] of [...agentRoutes(invalidId), ["GET", `${eventsPath}?agentId=${invalidId}`, undefined]] as const) {
      const hidden = await invoke(method, path, body)
      assert.equal(hidden.status, 404, summary(hidden))
      assert.deepEqual(hidden.body, { error: "personal_agent_not_found" })
    }
  }
  const foreignOwner = await asLee("POST", `${adminAgent}/transfer`, { memberId: otherLee.memberId })
  assert.equal(foreignOwner.status, 400, summary(foreignOwner))
  const transferred = await asLee("POST", `${adminAgent}/transfer`, { memberId: sam.memberId })
  assert.equal(transferred.status, 200, summary(transferred))
  const moved = personalAgentAdminItemSchema.parse(transferred.body)
  assert.equal(moved.owner.name, sam.name)
  assert.deepEqual(moved.sharedWith, [])
  const samList = await asSam("GET", "/v1/personal-agents")
  assert.equal(samList.status, 200, summary(samList))
  assert.equal(personalAgentListSchema.parse(samList.body).items.find((item) => item.agent.id === id)?.role, "owner")
  assert.equal((await asDana("GET", memberAgent)).status, 404)
  const samRoutine = await asSam("GET", `/v1/automations/${routine.id}`)
  assert.equal(samRoutine.status, 200, summary(samRoutine))
  const movedRoutine = automationDetailSchema.parse(samRoutine.body).automation
  assert.equal(movedRoutine.ownerMemberId, sam.memberId)
  assert.equal(movedRoutine.nextDueAt, routine.nextDueAt)

  const archived = await asLee("POST", `${adminAgent}/archive`)
  assert.equal(archived.status, 200, summary(archived))
  assert.doesNotMatch(archived.text, /"brief"|Private instructions/)
  assert.equal(personalAgentAdminItemSchema.parse(archived.body).agent.state, "archived")
  const archivedRoutine = await asSam("GET", `/v1/automations/${routine.id}`)
  assert.equal(archivedRoutine.status, 200, summary(archivedRoutine))
  assert.equal(automationDetailSchema.parse(archivedRoutine.body).automation.state, "archived")
  const remaining = await asLee("GET", agents)
  assert.equal(remaining.status, 200, summary(remaining))
  assert.deepEqual(personalAgentAdminListSchema.parse(remaining.body).items.map((item) => item.agent.id), [samAgent.id])

  for (const access of ["allow", "ask"] as const) {
    const refused = await asLee("PUT", policyPath, { toolPolicy: { tools: { [connectionId]: { create_issue: access } } } })
    assert.equal(refused.status, 400, summary(refused))
    assert.equal(field(refused.body, "message"), "An organization policy can only block connections or tools.")
  }
  const unknown = await asLee("PUT", policyPath, { toolPolicy: { connections: { [createDenTypeId("externalMcpConnection")]: "block" } } })
  assert.equal(unknown.status, 400, summary(unknown))
  const policy = { toolPolicy: { connections: {}, tools: { [connectionId]: { create_issue: "block" } } }, monthlyBudgetMicros: 200_000 }
  const stored = await asLee("PUT", policyPath, policy)
  assert.equal(stored.status, 200, summary(stored))
  assert.deepEqual(personalAgentOrgPolicySchema.parse(stored.body), policy)
  const lowered = await asLee("PUT", policyPath, { monthlyBudgetMicros: 150_000 })
  assert.equal(lowered.status, 200, summary(lowered))
  const read = await asLee("GET", policyPath)
  assert.equal(read.status, 200, summary(read))
  assert.deepEqual(read.body, { ...policy, monthlyBudgetMicros: 150_000 })

  const allEvents = await asLee("GET", eventsPath)
  assert.equal(allEvents.status, 200, summary(allEvents))
  const events = personalAgentEventListSchema.parse(allEvents.body).items
  assert.deepEqual(events.slice(0, 3).map((entry) => [entry.action, entry.actor.name]), [
    ["organization.budget_set", lee.name], ["organization.budget_set", lee.name], ["organization.tools_changed", lee.name],
  ])
  assert.deepEqual(events[2]?.detail, { blockedTools: 1, blockedConnections: 0 })
  const agentEvents = await asLee("GET", `${eventsPath}?agentId=${id}&limit=5`)
  assert.equal(agentEvents.status, 200, summary(agentEvents))
  assert.deepEqual(personalAgentEventListSchema.parse(agentEvents.body).items.map((entry) => [entry.action, entry.actor.name, entry.detail]), [
    ["agent.archived", lee.name, { byAdmin: true }], ["agent.transferred", lee.name, { from: dana.name, to: sam.name }],
    ["agent.budget_set", lee.name, { monthlyBudgetMicros: 100_000 }], ["agent.resumed", lee.name, {}], ["agent.paused", lee.name, {}],
  ])
})
