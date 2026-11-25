import { AUTOMATION_CLOUD_DEFAULT_MODEL, type AutomationRun } from "@openwork/types/automations"
import type { AutomationListItem } from "@openwork/automations"
import {
  EMPTY_PERSONAL_AGENT_TOOL_POLICY,
  type CreatePersonalAgent,
  type CreatePersonalAgentRoutine,
  type PersonalAgentAccess,
  type PersonalAgentDetail,
  type PersonalAgentToolPolicy,
  type RunPersonalAgentNow,
  type UpdatePersonalAgent,
} from "@openwork/types/den/personal-agents"
import { isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { listAgentRoutines } from "../automations/repository.js"
import { automationService, type AutomationPlacementOptions, type AutomationService } from "../automations/service.js"
import { getExternalMcpConnection } from "../capability-sources/external-mcp-connections.js"
import { personalAgentRepository } from "./repository.js"

type OwnerScope = Parameters<AutomationService["create"]>[0]

/**
 * The run's credential can leave out an organization connector or one of its
 * tools. Built-in connectors are not connections of that kind, so a policy
 * naming one is refused instead of being stored and silently not applied.
 */
async function enforceableToolPolicy(organizationId: string, policy: PersonalAgentToolPolicy): Promise<PersonalAgentToolPolicy> {
  const canonicalIds = new Map<string, string>()
  for (const connectionId of new Set([...Object.keys(policy.connections), ...Object.keys(policy.tools)])) {
    if (!isDenTypeId("externalMcpConnection", connectionId)) throw new Error("personal_agent_tool_policy_connection_invalid")
    const connection = await getExternalMcpConnection({
      organizationId: normalizeDenTypeId("organization", organizationId),
      connectionId: normalizeDenTypeId("externalMcpConnection", connectionId),
    })
    if (!connection || connection.kind !== "external_mcp") throw new Error("personal_agent_tool_policy_connection_invalid")
    canonicalIds.set(connectionId, connection.id)
  }
  const canonical = (connectionId: string) => canonicalIds.get(connectionId) ?? connectionId
  const connections: Record<string, PersonalAgentAccess> = {}
  for (const [connectionId, access] of Object.entries(policy.connections)) connections[canonical(connectionId)] = access
  const tools: Record<string, Record<string, PersonalAgentAccess>> = {}
  for (const [connectionId, entries] of Object.entries(policy.tools)) tools[canonical(connectionId)] = { ...entries }
  return { connections, tools }
}

export class PersonalAgentService {
  constructor(private readonly automations: AutomationService = automationService) {}

  async create(scope: OwnerScope, definition: CreatePersonalAgent): Promise<PersonalAgentDetail> {
    const toolPolicy = await enforceableToolPolicy(scope.organizationId, definition.toolPolicy ?? EMPTY_PERSONAL_AGENT_TOOL_POLICY)
    return personalAgentRepository.create({ ...scope, definition, toolPolicy, now: Date.now() })
  }

  async update(scope: OwnerScope, agentId: string, changes: UpdatePersonalAgent): Promise<PersonalAgentDetail | null> {
    const toolPolicy = changes.toolPolicy ? await enforceableToolPolicy(scope.organizationId, changes.toolPolicy) : undefined
    return personalAgentRepository.update({ ...scope, agentId, changes, toolPolicy, now: Date.now() })
  }

  list(scope: OwnerScope, input: { cursor?: string; limit?: number }) {
    return personalAgentRepository.list({ ...scope, cursor: input.cursor, limit: input.limit ?? 50 })
  }

  get(scope: OwnerScope, agentId: string) {
    return personalAgentRepository.get({ ...scope, agentId })
  }

  archive(scope: OwnerScope, agentId: string) {
    return personalAgentRepository.archive({ ...scope, agentId, now: Date.now() })
  }

  private async active(scope: OwnerScope, agentId: string): Promise<PersonalAgentDetail | null> {
    const agent = await this.get(scope, agentId)
    return agent && agent.agent.state === "active" ? agent : null
  }

  async listRoutines(scope: OwnerScope, agentId: string): Promise<{ items: AutomationListItem[] } | null> {
    const agent = await this.get(scope, agentId)
    if (!agent) return null
    return { items: await listAgentRoutines({ ...scope, agentId: agent.agent.id }) }
  }

  /** A routine is a Cloud Automation that belongs to the agent; every Automation rule applies to it. */
  async createRoutine(scope: OwnerScope, agentId: string, routine: CreatePersonalAgentRoutine): Promise<AutomationListItem | null> {
    const agent = await this.active(scope, agentId)
    if (!agent) return null
    return this.automations.create(scope, {
      name: routine.name,
      schedule: routine.schedule,
      action: {
        kind: "agent",
        instructions: routine.instructions,
        model: routine.model ?? {
          providerId: AUTOMATION_CLOUD_DEFAULT_MODEL.providerId,
          modelId: AUTOMATION_CLOUD_DEFAULT_MODEL.modelId,
          variant: null,
        },
      },
      executionTarget: "cloud",
    }, { agent: { agentId: agent.agent.id } })
  }

  /** Runs one of the agent's routines now, as a manual Automation run pinned to the routine's agent version. */
  async runNow(scope: OwnerScope, agentId: string, input: RunPersonalAgentNow, options: AutomationPlacementOptions = {}): Promise<{
    run: AutomationRun
    routine: AutomationListItem
    agentRevision: { id: string; version: number }
  } | null> {
    const agent = await this.active(scope, agentId)
    if (!agent) return null
    const routines = await listAgentRoutines({ ...scope, agentId: agent.agent.id })
    if (routines.length === 0) throw new Error("personal_agent_routine_required")
    const chosen = input.routineId
      ? routines.find((routine) => routine.automation.id === input.routineId)
      : routines.length === 1 ? routines[0] : undefined
    if (!chosen) throw new Error(input.routineId ? "personal_agent_routine_not_found" : "personal_agent_routine_ambiguous")
    const run = await this.automations.runNow(scope, chosen.automation.id, options)
    const receipt = run ? await this.automations.getRun(scope, run.id) : null
    const pinned = receipt?.revision.agentRevisionId
      ? await personalAgentRepository.runDefinition(receipt.revision.agentRevisionId)
      : null
    if (!receipt || !pinned) throw new Error("personal_agent_routine_not_found")
    return {
      run: receipt.run,
      routine: { automation: receipt.automation, revision: receipt.revision, latestRun: receipt.run },
      agentRevision: { id: pinned.revisionId, version: pinned.version },
    }
  }
}

export const personalAgentService = new PersonalAgentService()
