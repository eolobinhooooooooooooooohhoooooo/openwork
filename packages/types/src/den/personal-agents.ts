import { z } from "zod"
import {
  automationDetailSchema,
  automationExecutionTargetSchema,
  automationModelSchema,
  automationRunSchema,
  automationScheduleSchema,
} from "../automations"

const idSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.number().int().nonnegative()

export const PERSONAL_AGENT_NAME_MAX_LENGTH = 120
export const PERSONAL_AGENT_BRIEF_MAX_LENGTH = 60_000
export const PERSONAL_AGENT_TOOL_POLICY_MAX_CONNECTIONS = 100
export const PERSONAL_AGENT_TOOL_POLICY_MAX_TOOLS = 200
/** Every blocked tool is one entry on the run's credential, so the whole policy stays small enough to carry. */
export const PERSONAL_AGENT_TOOL_POLICY_MAX_BLOCKED = 400

export const personalAgentAccessSchema = z.enum(["allow", "block"]).meta({ ref: "PersonalAgentAccess" })
export type PersonalAgentAccess = z.infer<typeof personalAgentAccessSchema>

const connectionIdSchema = z.string().trim().min(1).max(160)
const toolNameSchema = z.string().trim().min(1).max(200)

/**
 * What an agent may use of its owner's connections while it runs unattended.
 *
 * An agent starts with every connection its owner has, like an Automation.
 * `connections` blocks a whole connection; `tools` blocks single tools of a
 * connection that stays allowed. A blocked connection wins over its tools.
 * "allow" entries record an explicit choice and change nothing.
 */
export const personalAgentToolPolicySchema = z.object({
  connections: z.record(connectionIdSchema, personalAgentAccessSchema).default({}),
  tools: z.record(connectionIdSchema, z.record(toolNameSchema, personalAgentAccessSchema)).default({}),
}).strict().superRefine((policy, context) => {
  if (Object.keys(policy.connections).length > PERSONAL_AGENT_TOOL_POLICY_MAX_CONNECTIONS
    || Object.keys(policy.tools).length > PERSONAL_AGENT_TOOL_POLICY_MAX_CONNECTIONS) {
    context.addIssue({ code: "custom", message: `A tool policy may name at most ${PERSONAL_AGENT_TOOL_POLICY_MAX_CONNECTIONS} connections.` })
  }
  let blocked = Object.values(policy.connections).filter((access) => access === "block").length
  for (const [connectionId, tools] of Object.entries(policy.tools)) {
    if (Object.keys(tools).length > PERSONAL_AGENT_TOOL_POLICY_MAX_TOOLS) {
      context.addIssue({ code: "custom", path: ["tools", connectionId], message: `A tool policy may name at most ${PERSONAL_AGENT_TOOL_POLICY_MAX_TOOLS} tools of one connection.` })
    }
    blocked += Object.values(tools).filter((access) => access === "block").length
  }
  if (blocked > PERSONAL_AGENT_TOOL_POLICY_MAX_BLOCKED) {
    context.addIssue({ code: "custom", message: `A tool policy may block at most ${PERSONAL_AGENT_TOOL_POLICY_MAX_BLOCKED} connections and tools. Block the whole connection instead.` })
  }
}).meta({ ref: "PersonalAgentToolPolicy" })
export type PersonalAgentToolPolicy = z.infer<typeof personalAgentToolPolicySchema>

export const EMPTY_PERSONAL_AGENT_TOOL_POLICY: PersonalAgentToolPolicy = { connections: {}, tools: {} }

export const personalAgentBriefSchema = z.string().trim().min(1).max(PERSONAL_AGENT_BRIEF_MAX_LENGTH)
  .describe("The agent's definition, as Markdown: who it is, what it does, how it reports. Every run of the agent starts from it.")

/** Stored for the per-agent spending limit; nothing enforces it yet. */
export const personalAgentMonthlyBudgetSchema = z.number().int().nonnegative().max(1_000_000_000_000)
  .describe("Monthly spending limit in millionths of a US dollar. Recorded now; not enforced yet.")

export const personalAgentStateSchema = z.enum(["active", "archived"]).meta({ ref: "PersonalAgentState" })
export type PersonalAgentState = z.infer<typeof personalAgentStateSchema>

export const personalAgentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  ownerMemberId: idSchema,
  name: z.string().trim().min(1).max(PERSONAL_AGENT_NAME_MAX_LENGTH),
  state: personalAgentStateSchema,
  currentRevisionId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
}).meta({ ref: "PersonalAgent" })
export type PersonalAgent = z.infer<typeof personalAgentSchema>

export const personalAgentRevisionSchema = z.object({
  id: idSchema,
  agentId: idSchema,
  version: z.number().int().positive(),
  brief: personalAgentBriefSchema,
  toolPolicy: personalAgentToolPolicySchema,
  defaultExecutionTarget: automationExecutionTargetSchema,
  monthlyBudgetMicros: personalAgentMonthlyBudgetSchema.nullable(),
  digest: z.string().trim().min(16).max(128),
  createdAt: timestampSchema,
}).meta({ ref: "PersonalAgentRevision" })
export type PersonalAgentRevision = z.infer<typeof personalAgentRevisionSchema>

export const personalAgentDetailSchema = z.object({
  agent: personalAgentSchema,
  revision: personalAgentRevisionSchema,
  routineCount: z.number().int().nonnegative(),
}).meta({ ref: "PersonalAgentDetail" })
export type PersonalAgentDetail = z.infer<typeof personalAgentDetailSchema>

export const personalAgentListSchema = z.object({
  items: z.array(personalAgentDetailSchema),
  nextCursor: z.string().nullable(),
}).meta({ ref: "PersonalAgentList" })
export type PersonalAgentList = z.infer<typeof personalAgentListSchema>

export const createPersonalAgentSchema = z.object({
  name: z.string().trim().min(1).max(PERSONAL_AGENT_NAME_MAX_LENGTH),
  brief: personalAgentBriefSchema,
  toolPolicy: personalAgentToolPolicySchema.optional(),
  defaultExecutionTarget: automationExecutionTargetSchema.optional(),
  monthlyBudgetMicros: personalAgentMonthlyBudgetSchema.nullable().optional(),
}).strict().meta({ ref: "CreatePersonalAgent" })
export type CreatePersonalAgent = z.infer<typeof createPersonalAgentSchema>

export const updatePersonalAgentSchema = z.object({
  name: z.string().trim().min(1).max(PERSONAL_AGENT_NAME_MAX_LENGTH).optional(),
  brief: personalAgentBriefSchema.optional(),
  toolPolicy: personalAgentToolPolicySchema.optional(),
  defaultExecutionTarget: automationExecutionTargetSchema.optional(),
  monthlyBudgetMicros: personalAgentMonthlyBudgetSchema.nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "At least one field is required")
  .meta({ ref: "UpdatePersonalAgent" })
export type UpdatePersonalAgent = z.infer<typeof updatePersonalAgentSchema>

/**
 * A routine is an ordinary Cloud Automation that belongs to the agent. Its
 * instructions say what this routine does; the agent's brief is added in front
 * of them when it runs.
 */
export const createPersonalAgentRoutineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(100_000)
    .describe("What this routine does each time it runs. The agent's brief is added in front of it."),
  schedule: automationScheduleSchema,
  model: automationModelSchema.optional()
    .describe("Omit to run on the organization's cloud default model."),
}).strict().meta({ ref: "CreatePersonalAgentRoutine" })
export type CreatePersonalAgentRoutine = z.infer<typeof createPersonalAgentRoutineSchema>

export const personalAgentRoutineListSchema = z.object({
  items: z.array(automationDetailSchema),
}).meta({ ref: "PersonalAgentRoutineList" })
export type PersonalAgentRoutineList = z.infer<typeof personalAgentRoutineListSchema>

export const runPersonalAgentNowSchema = z.object({
  routineId: idSchema.optional()
    .describe("Which of the agent's routines to run. Optional when the agent has exactly one."),
}).strict().meta({ ref: "RunPersonalAgentNow" })
export type RunPersonalAgentNow = z.infer<typeof runPersonalAgentNowSchema>

export const personalAgentRunResponseSchema = z.object({
  run: automationRunSchema,
  routine: automationDetailSchema,
  agentRevision: personalAgentRevisionSchema.pick({ id: true, version: true }),
}).meta({ ref: "PersonalAgentRunResponse" })
export type PersonalAgentRunResponse = z.infer<typeof personalAgentRunResponseSchema>
