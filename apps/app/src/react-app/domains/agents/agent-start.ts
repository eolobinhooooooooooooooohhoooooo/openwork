import type { AutomationDetail } from "@openwork/types/automations";
import type {
  CreatePersonalAgent,
  CreatePersonalAgentRoutine,
  PersonalAgentDetail,
  PersonalAgentProposal,
  PersonalAgentRunResponse,
} from "@openwork/types/den/personal-agents";

export type AgentStartApi = {
  createAgent: (input: CreatePersonalAgent) => Promise<PersonalAgentDetail>;
  createRoutine: (agentId: string, input: CreatePersonalAgentRoutine) => Promise<AutomationDetail>;
  runNow: (agentId: string, routineId: string) => Promise<PersonalAgentRunResponse>;
};

export type AgentStartProgress = {
  agentId: string | null;
  agentName: string | null;
  routineId: string | null;
  routineName: string | null;
  firstRunId: string | null;
};

const starting = new Map<string, Promise<AgentStartProgress>>();

export function startOnce(key: string, start: () => Promise<AgentStartProgress>): Promise<AgentStartProgress> {
  const running = starting.get(key);
  if (running) return running;
  const started = start().finally(() => starting.delete(key));
  starting.set(key, started);
  return started;
}

export async function startAgentFromProposal(input: {
  api: AgentStartApi;
  proposal: PersonalAgentProposal;
  saved: AgentStartProgress;
  save: (progress: Partial<AgentStartProgress>) => void;
}): Promise<AgentStartProgress> {
  const { api, proposal, save } = input;
  let progress = input.saved;
  const keep = (next: Partial<AgentStartProgress>) => {
    progress = { ...progress, ...next };
    save(next);
  };
  if (!progress.agentId) {
    const created = await api.createAgent({ name: proposal.name, brief: proposal.brief });
    keep({ agentId: created.agent.id, agentName: created.agent.name });
  }
  const agentId = progress.agentId;
  if (!agentId) return progress;
  if (!progress.routineId) {
    const routine = await api.createRoutine(agentId, proposal.routine);
    keep({ routineId: routine.automation.id, routineName: routine.automation.name });
  }
  const routineId = progress.routineId;
  if (!routineId) return progress;
  if (!progress.firstRunId) {
    const started = await api.runNow(agentId, routineId);
    keep({ firstRunId: started.run.id });
  }
  return progress;
}
