import { useMemo } from "react";

import type { SessionExtensions } from "@/react-app/kernel/session-extensions";
import { t } from "@/i18n";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { AgentGreeting } from "./agent-greeting";
import { AgentHeaderTitle } from "./agent-header";
import { AgentPanel } from "./agent-panel";
import { AgentProposalCard } from "./agent-proposal-card";
import { AgentSidebarSection } from "./agent-sidebar-section";
import { AgentTranscriptFooter } from "./agent-transcript-footer";
import { useAgentsRuntime } from "./agents-runtime";

function useOwnsSession(sessionId: string | null): boolean {
  const runtime = useAgentsRuntime();
  return useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, sessionId) !== null);
}

function useComposerPlaceholder(sessionId: string | null): string | null {
  const runtime = useAgentsRuntime();
  return useAgentChatStore((state) => {
    const chat = agentChatFor(state.chats, runtime?.organizationId ?? null, sessionId);
    if (!chat) return null;
    if (chat.agentId) return t("agents.placeholder_message", { name: chat.agentName ?? t("agents.new") });
    return chat.asked ? t("agents.placeholder_answer") : t("agents.placeholder_new");
  });
}

function useSidebarHiddenSessionIds(): ReadonlySet<string> {
  const organizationId = useAgentsRuntime()?.organizationId ?? null;
  const chats = useAgentChatStore((state) => state.chats);
  return useMemo(
    () => new Set(Object.values(chats).filter((chat) => chat.organizationId === organizationId).map((chat) => chat.sessionId)),
    [chats, organizationId],
  );
}

export const personalAgentSessionExtensions: SessionExtensions = {
  SidebarSection: AgentSidebarSection,
  HeaderTitle: AgentHeaderTitle,
  Greeting: AgentGreeting,
  ProposalCard: AgentProposalCard,
  TranscriptFooter: AgentTranscriptFooter,
  Panel: AgentPanel,
  useOwnsSession,
  useSidebarHiddenSessionIds,
  useComposerPlaceholder,
};


