import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";

import { parsePersonalAgentProposal } from "@/components/tools/openwork-automation-proposal";
import type { SessionProposalCardProps } from "@/react-app/kernel/session-extensions";
import { t } from "@/i18n";

import { useAgentChatStore } from "./agent-chat-store";
import { AgentChoices } from "./agent-choices";
import { AgentFace } from "./agent-face";
import { AgentRunResult } from "./agent-run-result";
import { startAgentFromProposal } from "./agent-start";
import { scheduleInWords } from "./agent-words";
import { useAgentsRuntime } from "./agents-runtime";
import { agentsQueryRoot } from "./use-agents";

export function AgentProposalCard(props: SessionProposalCardProps) {
  const runtime = useAgentsRuntime();
  const queryClient = useQueryClient();
  const chat = useAgentChatStore((state) => state.chats[props.sessionId]);
  const proposal = parsePersonalAgentProposal(props.part.output);
  const start = useMutation({
    mutationFn: async () => {
      if (!runtime || !proposal) throw new Error(t("agents.start_sign_in"));
      const store = useAgentChatStore.getState();
      store.open({ organizationId: runtime.organizationId, workspaceId: props.workspaceId, sessionId: props.sessionId, proposalId: props.part.toolCallId });
      const saved = useAgentChatStore.getState().chats[props.sessionId];
      const progress = await startAgentFromProposal({
        api: {
          createAgent: (input) => runtime.client.createPersonalAgent(runtime.organizationId, input),
          createRoutine: (agentId, input) => runtime.client.createPersonalAgentRoutine(runtime.organizationId, agentId, input),
          runNow: (agentId, routineId) => runtime.client.runPersonalAgentNow(runtime.organizationId, agentId, { routineId }),
        },
        proposal,
        saved: {
          agentId: saved?.agentId ?? null,
          agentName: saved?.agentName ?? null,
          routineId: saved?.routineId ?? null,
          routineName: saved?.routineName ?? null,
          firstRunId: saved?.firstRunId ?? null,
        },
        save: (next) => useAgentChatStore.getState().save(props.sessionId, next),
      });
      if (progress.agentName) runtime.renameSession(props.workspaceId, props.sessionId, progress.agentName);
      return progress;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentsQueryRoot(runtime?.organizationId ?? null) }),
  });

  if (!proposal) return null;
  const mine = chat?.proposalId === props.part.toolCallId;
  if (!mine && (chat?.agentId || !props.latest)) return null;

  if (mine && chat?.routineId && runtime) {
    return (
      <div data-agent-started={chat.agentId ?? ""} className="flex flex-col gap-4">
        <p className="flex items-center justify-center gap-1.5 text-xs text-dls-secondary">
          <Clock aria-hidden="true" className="size-3.5" />
          {t("agents.created_routine", { name: chat.routineName ?? proposal.routine.name })}
        </p>
        <p data-agent-line className="text-[13px] leading-relaxed text-foreground">
          {chat.firstRunId ? t("agents.you_are_set") : t("agents.you_are_set_waiting")}
        </p>
        {chat.firstRunId
          ? <AgentRunResult runtime={runtime} runId={chat.firstRunId} routineName={chat.routineName ?? proposal.routine.name} />
          : null}
        {!chat.firstRunId ? (
          <AgentChoices choices={[{ id: "retry", label: start.isPending ? t("agents.start_starting") : t("agents.start_retry"), disabled: start.isPending, onSelect: () => start.mutate() }]}
            description={start.error instanceof Error ? start.error.message : null} />
        ) : null}
      </div>
    );
  }

  const failed = start.error instanceof Error ? start.error.message : null;
  return (
    <div data-agent-proposal={props.part.toolCallId} className="flex flex-col gap-3">
      <p className="flex min-w-0 items-center gap-2 text-sm text-dls-secondary">
        <AgentFace name={proposal.name} />
        <span className="truncate font-medium text-dls-text">{proposal.name}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{scheduleInWords(proposal.routine.schedule)}</span>
      </p>
      <AgentChoices
        title={t("agents.start_question")}
        description={failed ?? (runtime ? null : t("agents.start_sign_in"))}
        choices={[
          {
            id: "start",
            label: start.isPending ? t("agents.start_starting") : failed ? t("agents.start_retry") : t("agents.start_yes"),
            disabled: start.isPending || !runtime,
            onSelect: () => start.mutate(),
          },
          { id: "cadence", label: t("agents.start_cadence"), disabled: start.isPending, onSelect: () => props.setPrompt(t("agents.start_cadence_prompt")) },
          { id: "else", label: t("agents.start_else"), muted: true, disabled: start.isPending, onSelect: () => props.setPrompt("") },
        ]}
      />
    </div>
  );
}
