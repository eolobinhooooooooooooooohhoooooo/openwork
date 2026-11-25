import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { AgentFace } from "./agent-face";
import { useAgentsRuntime } from "./agents-runtime";

export function AgentHeaderTitle(props: { sessionId: string | null; children: ReactNode }) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, props.sessionId));
  const panelOpen = useAgentChatStore((state) => state.panelSessionId !== null && state.panelSessionId === props.sessionId);
  if (!chat) return props.children;
  const name = chat.agentName ?? t("agents.new");
  if (!chat.agentId) {
    return (
      <span data-agent-header="new" className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-dls-text">
        <AgentFace name={null} />
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-agent-header={chat.agentId}
      aria-expanded={panelOpen}
      aria-label={t("agents.panel_open", { name })}
      className="h-7 min-w-0 gap-2 rounded-full px-1.5 pe-2 text-[13px] font-medium text-dls-text titlebar-no-drag"
      onClick={() => useAgentChatStore.getState().setPanel(panelOpen ? null : chat.sessionId)}
    >
      <AgentFace name={name} />
      <span className="truncate">{name}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 text-dls-secondary" />
    </Button>
  );
}
