import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationDetail, AutomationRun } from "@openwork/types/automations";

import { t } from "@/i18n";

import type { AgentsRuntime } from "./agents-runtime";

const ACTIVE_RUN_STATUSES: readonly AutomationRun["status"][] = ["queued", "claimed", "running"];
const ACTIVE_POLL_MS = 2_500;
const IDLE_POLL_MS = 60_000;

export function isActiveRun(run: Pick<AutomationRun, "status"> | null | undefined): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}

export function agentsQueryRoot(organizationId: string | null) {
  return ["den", "personal-agents", organizationId] as const;
}

export function useAgentListQuery(runtime: AgentsRuntime | null) {
  return useQuery({
    queryKey: [...agentsQueryRoot(runtime?.organizationId ?? null), "list"],
    queryFn: async () => runtime ? (await runtime.client.listPersonalAgents(runtime.organizationId)).items : [],
    enabled: runtime !== null,
    staleTime: 10_000,
    refetchInterval: IDLE_POLL_MS,
  });
}

export function routinesByAgent(items: readonly AutomationDetail[]): Map<string, AutomationDetail[]> {
  const grouped = new Map<string, AutomationDetail[]>();
  for (const item of items) {
    const agentId = item.automation.agentId;
    if (!agentId || item.automation.state === "archived") continue;
    grouped.set(agentId, [...grouped.get(agentId) ?? [], item]);
  }
  return grouped;
}

export function useAgentRoutinesQuery(runtime: AgentsRuntime | null) {
  return useQuery({
    queryKey: [...agentsQueryRoot(runtime?.organizationId ?? null), "routines"],
    queryFn: async () => runtime ? (await runtime.client.listAutomations(runtime.organizationId, { limit: 100 })).items : [],
    enabled: runtime !== null,
    select: routinesByAgent,
    refetchInterval: (query) => (query.state.data ?? []).some((item) => item.automation.agentId && isActiveRun(item.latestRun)) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });
}

export function useAgentRunQuery(runtime: AgentsRuntime | null, runId: string | null) {
  return useQuery({
    queryKey: [...agentsQueryRoot(runtime?.organizationId ?? null), "run", runId],
    queryFn: async () => runtime && runId ? runtime.client.getAutomationRun(runtime.organizationId, runId) : null,
    enabled: runtime !== null && runId !== null,
    retry: 1,
    refetchInterval: (query) => query.state.status !== "error" && (!query.state.data || isActiveRun(query.state.data.run)) ? ACTIVE_POLL_MS : false,
  });
}

export function useRoutineRunsQuery(runtime: AgentsRuntime | null, routineId: string | null) {
  return useQuery({
    queryKey: [...agentsQueryRoot(runtime?.organizationId ?? null), "runs", routineId],
    queryFn: async () => runtime && routineId ? (await runtime.client.listAutomationRuns(runtime.organizationId, routineId, { limit: 5 })).items : [],
    enabled: runtime !== null && routineId !== null,
    refetchInterval: (query) => (query.state.data ?? []).some(isActiveRun) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });
}

export function useAgentActions(runtime: AgentsRuntime | null) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: agentsQueryRoot(runtime?.organizationId ?? null) });
  const runNow = useMutation({
    mutationFn: async (input: { agentId: string; routineId: string }) => {
      if (!runtime) throw new Error(t("agents.start_sign_in"));
      return runtime.client.runPersonalAgentNow(runtime.organizationId, input.agentId, { routineId: input.routineId });
    },
    onSettled: refresh,
  });
  const setActive = useMutation({
    mutationFn: async (input: { routineIds: string[]; active: boolean }) => {
      if (!runtime) throw new Error(t("agents.start_sign_in"));
      for (const routineId of input.routineIds) {
        if (input.active) await runtime.client.activateAutomation(runtime.organizationId, routineId);
        else await runtime.client.deactivateAutomation(runtime.organizationId, routineId);
      }
    },
    onSettled: refresh,
  });
  return { runNow, setActive, refresh };
}
