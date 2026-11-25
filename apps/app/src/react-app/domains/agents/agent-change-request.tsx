import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PersonalAgentDetail, PersonalAgentRequest } from "@openwork/types/den/personal-agents";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { firstName, scheduleInWords } from "./agent-words";
import type { AgentsRuntime } from "./agents-runtime";
import { agentListKey, agentRequestsKey } from "./use-agents";

export function changeRequestLine(request: Pick<PersonalAgentRequest, "status" | "summary" | "requestedBy" | "decidedBy" | "canDecide">, ownerName: string | null): string | null {
  const summary = request.summary?.trim() || t("agents.change_summary");
  const decider = request.decidedBy?.name || t("agents.change_reviewer");
  if (request.status === "approved") return t("agents.change_approved", { decider, summary });
  if (request.status === "denied") return t("agents.change_denied", { decider, summary });
  if (request.status !== "pending") return null;
  if (request.canDecide.includes("approve")) return t("agents.change_asks", { name: firstName(request.requestedBy.name), summary });
  return t("agents.change_waiting", { name: firstName(ownerName) || t("agents.panel_agent_owner"), summary });
}

export function AgentChangeRequest({ runtime, agent, request }: { runtime: AgentsRuntime; agent: PersonalAgentDetail; request: PersonalAgentRequest }) {
  const titleId = useId();
  const key = agentRequestsKey(runtime, agent.agent.id);
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") => runtime.client.decidePersonalAgentRequest(runtime.organizationId, agent.agent.id, request.id, decision),
    onSuccess: async (decided) => {
      queryClient.setQueryData<PersonalAgentRequest[]>(key, (items) => items?.map((item) => item.id === decided.id ? decided : item));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: agentListKey(runtime) }),
      ]);
    },
    onError: () => toast.error(t("agents.change_failed")),
  });
  const line = changeRequestLine(request, agent.owner?.name ?? null);
  if (!line) return null;
  const canDecide = request.status === "pending" && request.canDecide.includes("approve");
  if (!canDecide) {
    return request.status !== "pending" || agent.role === "collaborator"
      ? <p className="text-xs text-dls-secondary" role="status">{line}</p> : null;
  }
  const { schedule, instructions, brief } = request.change ?? {};
  return (
    <section aria-labelledby={titleId} className="w-full max-w-xl space-y-2 rounded-xl border border-dls-border bg-dls-surface p-3">
      <p id={titleId} className="text-sm font-medium">{line}</p>
      {schedule && <p className="text-sm text-dls-secondary">{scheduleInWords(schedule)}</p>}
      {instructions && <p className="whitespace-pre-wrap text-sm text-dls-secondary">{instructions}</p>}
      {brief && <p className="whitespace-pre-wrap text-sm text-dls-secondary">{brief}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>{t("agents.change_approve")}</Button>
        <Button size="sm" variant="ghost" disabled={decide.isPending || !request.canDecide.includes("deny")} onClick={() => decide.mutate("deny")}>{t("agents.change_deny")}</Button>
      </div>
    </section>
  );
}
