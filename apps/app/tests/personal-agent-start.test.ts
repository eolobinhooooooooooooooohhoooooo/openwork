import { expect, test } from "bun:test"
import type { DynamicToolUIPart } from "ai"
import type { PersonalAgentProposal } from "@openwork/types/den/personal-agents"

import { automationProposalsInParts, isAutomationProposalToolPart, isPersonalAgentProposalToolPart, parsePersonalAgentProposal } from "../src/components/tools/openwork-automation-proposal"
import { startAgentFromProposal, type AgentStartApi, type AgentStartProgress } from "../src/react-app/domains/agents/agent-start"
import { routinesByAgent } from "../src/react-app/domains/agents/use-agents"
import { scheduleInWords } from "../src/react-app/domains/agents/agent-words"

const proposal: PersonalAgentProposal = {
  name: "Bug watcher",
  brief: "Watch #bugs and file what is missing.",
  routine: {
    name: "Check #bugs",
    instructions: "Read new messages in #bugs and file missing issues.",
    schedule: { kind: "interval", timezone: "America/Los_Angeles", everyHours: 1, daysOfWeek: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
  },
}

const nothing: AgentStartProgress = { agentId: null, agentName: null, routineId: null, routineName: null, firstRunId: null }

function fakeApi(options: { failRuns?: number } = {}) {
  const calls: string[] = []
  let failures = options.failRuns ?? 0
  const detail = (value: object) => JSON.parse(JSON.stringify(value))
  const api: AgentStartApi = {
    createAgent: async (input) => {
      calls.push(`agent:${input.name}`)
      return detail({ agent: { id: "pag_1", name: input.name }, revision: {}, routineCount: 0 })
    },
    createRoutine: async (agentId, input) => {
      calls.push(`routine:${agentId}:${input.name}`)
      return detail({ automation: { id: "aut_1", name: input.name, agentId }, revision: {}, latestRun: null })
    },
    runNow: async (agentId, routineId) => {
      calls.push(`run:${agentId}:${routineId}`)
      if (failures > 0) {
        failures -= 1
        throw new Error("The runner is busy.")
      }
      return detail({ run: { id: "atr_1" }, routine: {}, agentRevision: { id: "rev_1", version: 1 } })
    },
  }
  return { api, calls }
}

test("saying yes creates the agent, then its routine, then starts the first run", async () => {
  const { api, calls } = fakeApi()
  const saved: Array<Partial<AgentStartProgress>> = []
  expect(calls).toEqual([])
  const progress = await startAgentFromProposal({ api, proposal, saved: nothing, save: (next) => saved.push(next) })
  expect(calls).toEqual(["agent:Bug watcher", "routine:pag_1:Check #bugs", "run:pag_1:aut_1"])
  expect(progress).toEqual({ agentId: "pag_1", agentName: "Bug watcher", routineId: "aut_1", routineName: "Check #bugs", firstRunId: "atr_1" })
  expect(saved).toEqual([
    { agentId: "pag_1", agentName: "Bug watcher" },
    { routineId: "aut_1", routineName: "Check #bugs" },
    { firstRunId: "atr_1" },
  ])
})

test("a first run that fails to start is retried without a second agent or routine", async () => {
  const { api, calls } = fakeApi({ failRuns: 1 })
  let kept = nothing
  const save = (next: Partial<AgentStartProgress>) => { kept = { ...kept, ...next } }
  await expect(startAgentFromProposal({ api, proposal, saved: kept, save })).rejects.toThrow("The runner is busy.")
  expect(kept).toEqual({ agentId: "pag_1", agentName: "Bug watcher", routineId: "aut_1", routineName: "Check #bugs", firstRunId: null })
  const progress = await startAgentFromProposal({ api, proposal, saved: kept, save })
  expect(calls).toEqual(["agent:Bug watcher", "routine:pag_1:Check #bugs", "run:pag_1:aut_1", "run:pag_1:aut_1"])
  expect(progress.firstRunId).toBe("atr_1")
})

test("an agent that already started is not started again", async () => {
  const { api, calls } = fakeApi()
  await startAgentFromProposal({
    api,
    proposal,
    saved: { agentId: "pag_1", agentName: "Bug watcher", routineId: "aut_1", routineName: "Check #bugs", firstRunId: "atr_1" },
    save: () => undefined,
  })
  expect(calls).toEqual([])
})

test("an agent proposal is found in a chat step and is not an Automation proposal", () => {
  const output = JSON.stringify({ ok: true, id: "agent.propose", result: { kind: "agent-proposal", created: false, proposal } })
  const part: DynamicToolUIPart = { type: "dynamic-tool", toolName: "openwork_execute", toolCallId: "call_1", state: "output-available", input: {}, output }
  expect(isPersonalAgentProposalToolPart(part)).toBe(true)
  expect(isAutomationProposalToolPart(part)).toBe(false)
  expect(automationProposalsInParts([part]).map((found) => found.toolCallId)).toEqual(["call_1"])
  expect(parsePersonalAgentProposal(output)?.routine.name).toBe("Check #bugs")
  expect(parsePersonalAgentProposal(JSON.stringify({ ok: true, id: "agent.propose", result: { proposal: { name: "No routine" } } }))).toBeNull()
  expect(parsePersonalAgentProposal(JSON.stringify({ ok: true, id: "automation.propose", result: { proposal } }))).toBeNull()
})

test("routines are grouped under their agent and schedules read as plain words", () => {
  const routine = (id: string, agentId: string | null, state: string) => JSON.parse(JSON.stringify({ automation: { id, agentId, state }, revision: {}, latestRun: null }))
  const grouped = routinesByAgent([routine("a", "pag_1", "active"), routine("b", null, "active"), routine("c", "pag_1", "archived"), routine("d", "pag_2", "inactive")])
  expect([...grouped.keys()]).toEqual(["pag_1", "pag_2"])
  expect(grouped.get("pag_1")?.map((item) => item.automation.id)).toEqual(["a"])
  expect(scheduleInWords(proposal.routine.schedule)).toBe("Every hour, 9 AM to 6 PM, weekdays")
  expect(scheduleInWords({ kind: "daily", timezone: "UTC", hour: 9, minute: 30 })).toBe("Every day at 9:30 AM")
  expect(scheduleInWords({ kind: "weekly", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5], hour: 8, minute: 0 })).toBe("Weekdays at 8 AM")
})
