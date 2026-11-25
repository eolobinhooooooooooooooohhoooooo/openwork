import type { Hono } from "hono"
import { describeRoute, type DescribeRouteOptions } from "hono-openapi"
import { z } from "zod"
import { automationDetailSchema } from "@openwork/types/automations"
import {
  createPersonalAgentRoutineSchema,
  createPersonalAgentSchema,
  personalAgentDetailSchema,
  personalAgentListSchema,
  personalAgentRoutineListSchema,
  personalAgentRunResponseSchema,
  runPersonalAgentNowSchema,
  updatePersonalAgentSchema,
} from "@openwork/types/den/personal-agents"
import { addAuditRequestResource } from "../../audit/request-capture.js"
import { requireFeature } from "../../features.js"
import {
  jsonValidator,
  orgMemberRoute,
  paramValidator,
  queryValidator,
  validationIssuesMessage,
  type OrganizationContextVariables,
} from "../../middleware/index.js"
import { invalidRequestSchema, jsonResponse, notFoundSchema } from "../../openapi.js"
import { personalAgentService, type PersonalAgentService } from "../../personal-agents/service.js"
import type { AuthContextVariables } from "../../session.js"
import { automationRouteFailure } from "../automations/index.js"

const idParamsSchema = z.object({ id: z.string().min(1).max(160) })
const paginationSchema = z.object({
  cursor: z.string().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

type McpDescribeRouteOptions = DescribeRouteOptions & { "x-mcp": true }
const describeMcpRoute = (options: McpDescribeRouteOptions) => describeRoute(options)

type RouteVariables = Partial<OrganizationContextVariables> & Partial<Pick<AuthContextVariables, "session">>

const about = [
  "A personal agent belongs to the member who made it: a name, a Markdown brief that says who it is and how it works, and which of the member's connections and tools it may use.",
  "Every change to the brief or tool policy makes a new version.",
  "An agent does its work through routines. A routine is a Cloud Automation that belongs to the agent, so it also appears in the Automation capabilities; each run starts from the agent's brief and can use only what the agent's tool policy allows.",
  "Only the owner sees or changes their agents.",
].join(" ")

const notFound = { error: "personal_agent_not_found" as const }

function scope(c: { get(name: "organizationContext"): OrganizationContextVariables["organizationContext"] }) {
  const context = c.get("organizationContext")
  return { organizationId: context.organization.id, ownerMemberId: context.currentMember.id, modelAttentionCapable: true }
}

function failure(error: unknown): { status: 400 | 403 | 404 | 409; body: { error: string; message?: string } } | null {
  if (error instanceof Error) {
    if (error.message === "personal_agent_not_found") return { status: 404, body: notFound }
    if (error.message === "personal_agent_tool_policy_connection_invalid") {
      return { status: 400, body: { error: error.message, message: "A tool policy can name only connectors added to this organization, by their connection id. Built-in connectors such as Google Workspace cannot be limited per agent yet." } }
    }
    if (error.message === "personal_agent_routine_required") {
      return { status: 409, body: { error: error.message, message: "This agent has no routine yet. Create a routine for it, then run it." } }
    }
    if (error.message === "personal_agent_routine_ambiguous") {
      return { status: 409, body: { error: error.message, message: "This agent has more than one routine. Pass routineId to choose which one to run." } }
    }
    if (error.message === "personal_agent_routine_not_found") {
      return { status: 404, body: { error: error.message, message: "That routine does not belong to this agent." } }
    }
  }
  return automationRouteFailure(error)
}

async function runNowBody(c: { req: { text(): Promise<string> } }) {
  const text = await c.req.text()
  if (!text.trim()) return runPersonalAgentNowSchema.safeParse({})
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return runPersonalAgentNowSchema.safeParse(body)
}

export function registerPersonalAgentRoutes<T extends { Variables: RouteVariables }>(
  app: Hono<T>,
  options: { service?: PersonalAgentService } = {},
) {
  const service = options.service ?? personalAgentService
  const gate = requireFeature("personalAgents")

  app.get(
    "/v1/personal-agents",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "listPersonalAgents", "x-mcp": true,
      summary: "List your personal agents", description: about,
      responses: {
        200: jsonResponse("Agents returned, newest first.", personalAgentListSchema),
        404: jsonResponse("Personal agents are not turned on for this organization.", notFoundSchema),
      },
    }),
    orgMemberRoute(), gate, queryValidator(paginationSchema),
    async (c) => c.json(await service.list(scope(c), c.req.valid("query"))),
  )

  app.post(
    "/v1/personal-agents",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "createPersonalAgent", "x-mcp": true,
      summary: "Create a personal agent",
      description: `${about} Create one only when the person asks for an agent. Write the brief as Markdown from what they said: what the agent watches or does, how it decides, and how it reports. The agent does nothing until it has a routine; add one with createPersonalAgentRoutine.`,
      responses: {
        201: jsonResponse("Agent created at version 1.", personalAgentDetailSchema),
        400: jsonResponse("Invalid request.", invalidRequestSchema),
        404: jsonResponse("Personal agents are not turned on for this organization.", notFoundSchema),
      },
    }),
    orgMemberRoute(), gate, jsonValidator(createPersonalAgentSchema),
    async (c) => {
      try {
        const created = await service.create(scope(c), c.req.valid("json"))
        addAuditRequestResource(c, { type: "personal_agent", id: created.agent.id })
        return c.json(created, 201)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )

  app.get(
    "/v1/personal-agents/:id",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "getPersonalAgent", "x-mcp": true,
      summary: "Get a personal agent and its current brief", description: about,
      responses: { 200: jsonResponse("Agent returned.", personalAgentDetailSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema),
    async (c) => {
      const agent = await service.get(scope(c), c.req.valid("param").id)
      return agent ? c.json(agent) : c.json(notFound, 404)
    },
  )

  app.patch(
    "/v1/personal-agents/:id",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "updatePersonalAgent", "x-mcp": true,
      summary: "Change a personal agent",
      description: `${about} Send only what changes. A new brief or tool policy replaces the old one whole, makes the next version, and applies to the agent's routines from their next run; a run already in progress keeps the version it started with. A rename alone keeps the version.`,
      responses: {
        200: jsonResponse("Agent updated.", personalAgentDetailSchema),
        400: jsonResponse("Invalid request.", invalidRequestSchema),
        404: jsonResponse("Not found.", notFoundSchema),
      },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema), jsonValidator(updatePersonalAgentSchema),
    async (c) => {
      try {
        const updated = await service.update(scope(c), c.req.valid("param").id, c.req.valid("json"))
        return updated ? c.json(updated) : c.json(notFound, 404)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )

  app.delete(
    "/v1/personal-agents/:id",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "archivePersonalAgent", "x-mcp": true,
      summary: "Archive a personal agent",
      description: `${about} Archiving also archives the agent's routines, so nothing keeps running. Run history is kept.`,
      responses: { 200: jsonResponse("Agent archived.", personalAgentDetailSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema),
    async (c) => {
      const archived = await service.archive(scope(c), c.req.valid("param").id)
      return archived ? c.json(archived) : c.json(notFound, 404)
    },
  )

  app.get(
    "/v1/personal-agents/:id/routines",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "listPersonalAgentRoutines", "x-mcp": true,
      summary: "List a personal agent's routines", description: about,
      responses: { 200: jsonResponse("Routines returned, newest first.", personalAgentRoutineListSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema),
    async (c) => {
      const routines = await service.listRoutines(scope(c), c.req.valid("param").id)
      return routines ? c.json(routines) : c.json(notFound, 404)
    },
  )

  app.post(
    "/v1/personal-agents/:id/routines",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "createPersonalAgentRoutine", "x-mcp": true,
      summary: "Give a personal agent a routine",
      description: `${about} The routine is active as soon as it exists and runs in OpenWork Cloud on its schedule. Its instructions say what this routine does; do not repeat the brief in them. Change, pause, or archive it afterwards with the Automation capabilities, using the returned automation id.`,
      responses: {
        201: jsonResponse("Routine created as an active Cloud Automation that carries the agent's id.", automationDetailSchema),
        400: jsonResponse("Invalid request.", invalidRequestSchema),
        403: jsonResponse("Cloud Automations are not available.", invalidRequestSchema),
        404: jsonResponse("Not found.", notFoundSchema),
        409: jsonResponse("Cloud runtime or model access is unavailable.", invalidRequestSchema),
      },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema), jsonValidator(createPersonalAgentRoutineSchema),
    async (c) => {
      try {
        const routine = await service.createRoutine(scope(c), c.req.valid("param").id, c.req.valid("json"))
        if (!routine) return c.json(notFound, 404)
        addAuditRequestResource(c, { type: "automation", id: routine.automation.id })
        return c.json(routine, 201)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )

  app.post(
    "/v1/personal-agents/:id/run",
    describeMcpRoute({
      tags: ["Personal agents"], operationId: "runPersonalAgentNow", "x-mcp": true,
      summary: "Run a personal agent now",
      description: `${about} Starts one run of the agent's routine now, in addition to its schedule. Pass routineId when the agent has more than one routine. The run is an Automation run: follow it with getAutomationRun.`,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                routineId: { type: "string", description: "Which of the agent's routines to run. Optional when the agent has exactly one." },
              },
            },
          },
        },
      },
      responses: {
        202: jsonResponse("Run queued, pinned to the agent version it will use.", personalAgentRunResponseSchema),
        400: jsonResponse("Invalid request.", invalidRequestSchema),
        403: jsonResponse("Cloud Automations are not available.", invalidRequestSchema),
        404: jsonResponse("Not found.", notFoundSchema),
        409: jsonResponse("The agent has no routine, has several, or the cloud runtime or model is unavailable.", invalidRequestSchema),
      },
    }),
    orgMemberRoute(), gate, paramValidator(idParamsSchema),
    async (c) => {
      const body = await runNowBody(c)
      if (!body.success) {
        return c.json({ error: "invalid_request", message: validationIssuesMessage(body.error.issues), details: body.error.issues }, 400)
      }
      try {
        const started = await service.runNow(scope(c), c.req.valid("param").id, body.data, { agentCaller: c.get("session")?.id === "mcp_internal" })
        if (!started) return c.json(notFound, 404)
        addAuditRequestResource(c, { type: "automation_run", id: started.run.id })
        return c.json(started, 202)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )
}
