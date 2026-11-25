import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Clock } from "lucide-react";

import { parsePersonalAgentProposal } from "@/components/tools/openwork-automation-proposal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { SessionProposalCardProps } from "@/react-app/kernel/session-extensions";
import { t } from "@/i18n";

import { isStandingChat, useAgentChatStore } from "./agent-chat-store";
import { AgentChoices } from "./agent-choices";
import { AgentFace } from "./agent-face";
import { AgentRunResult } from "./agent-run-result";
import { startAgentFromProposal, startOnce } from "./agent-start";
import { scheduleInWords, scheduleZone } from "./agent-words";
import { useAgentsRuntime } from "./agents-runtime";
import { agentsQueryRoot } from "./use-agents";

export function AgentProposalCard(props: SessionProposalCardProps) {
  const runtime = useAgentsRuntime();
  const queryClient = useQueryClient();
  const chat = useAgentChatStore((state) => state.chats[props.sessionId]);
  const proposal = parsePersonalAgentProposal(props.part.output);
  const start = useMutation({
    mutationFn: () => startOnce(props.sessionId, async () => {
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
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentsQueryRoot(runtime?.organizationId ?? null) }),
  });

  if (!proposal) return null;
  const mine = chat?.proposalId === props.part.toolCallId;
  if (!mine && ((chat && isStandingChat(chat)) || !props.latest || props.readOnly)) return null;

  const failed = start.error instanceof Error ? start.error.message : null;
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
          : (
            <AgentChoices
              description={failed}
              choices={[{
                id: "retry",
                label: start.isPending ? t("agents.start_starting") : t("agents.start_retry"),
                disabled: start.isPending || props.readOnly,
                onSelect: () => start.mutate(),
              }]}
            />
          )}
      </div>
    );
  }

  const zone = scheduleZone(proposal.routine.schedule);
  return (
    <div data-agent-proposal={props.part.toolCallId} className="flex flex-col gap-3">
      <p className="flex min-w-0 items-center gap-2 text-[13px] text-dls-secondary">
        <AgentFace name={proposal.name} />
        <span className="truncate font-medium text-dls-text">{proposal.name}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{[scheduleInWords(proposal.routine.schedule), zone].filter(Boolean).join(", ")}</span>
      </p>
      <AgentChoices
        title={t("agents.start_question")}
        description={failed ?? (runtime ? t("agents.start_effect", { name: proposal.name, routine: proposal.routine.name }) : t("agents.start_sign_in"))}
        choices={[
          {
            id: "start",
            label: start.isPending ? t("agents.start_starting") : failed ? t("agents.start_retry") : t("agents.start_yes"),
            disabled: start.isPending || !runtime || props.readOnly,
            onSelect: () => start.mutate(),
          },
          { id: "cadence", label: t("agents.start_cadence"), disabled: start.isPending || props.readOnly, onSelect: () => props.setPrompt(t("agents.start_cadence_prompt")) },
          { id: "else", label: t("agents.start_else"), muted: true, disabled: start.isPending || props.readOnly, onSelect: () => props.setPrompt("") },
        ]}
      />
      <Collapsible className="max-w-[560px] text-xs text-dls-secondary">
        <CollapsibleTrigger data-agent-proposal-details className="group/details flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight aria-hidden="true" className="size-3 transition-transform group-data-panel-open/details:rotate-90" />
          {t("agents.start_details")}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 px-1 pt-2">
          <p className="font-medium text-dls-text">{t("agents.start_brief")}</p>
          <p className="whitespace-pre-wrap">{proposal.brief}</p>
          <p className="font-medium text-dls-text">{t("agents.start_instructions", { routine: proposal.routine.name })}</p>
          <p className="whitespace-pre-wrap">{proposal.routine.instructions}</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
