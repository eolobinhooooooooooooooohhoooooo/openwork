import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { t } from "@/i18n";

import { agentChatForAgent, useAgentChatStore, type AgentChat } from "./agent-chat-store";
import { AgentFace } from "./agent-face";
import { useAgentsRuntime } from "./agents-runtime";
import { isActiveRun, useAgentListQuery, useAgentRoutinesQuery } from "./use-agents";

type AgentRow = {
  key: string;
  name: string | null;
  agentId: string | null;
  chat: AgentChat | null;
  working: boolean;
};

function unusedDraft(chats: Record<string, AgentChat>, organizationId: string, workspaceId: string): AgentChat | null {
  return Object.values(chats).find((chat) => chat.organizationId === organizationId && chat.workspaceId === workspaceId && !chat.agentId && !chat.asked) ?? null;
}

export function AgentSidebarSection() {
  const runtime = useAgentsRuntime();
  const chats = useAgentChatStore((state) => state.chats);
  const agents = useAgentListQuery(runtime).data;
  const routines = useAgentRoutinesQuery(runtime).data;
  const open = useMutation({
    mutationFn: async (row: AgentRow | null) => {
      if (!runtime) return;
      const chat = row ? row.chat : unusedDraft(useAgentChatStore.getState().chats, runtime.organizationId, runtime.workspaceId);
      if (chat) return runtime.openSession(chat.workspaceId, chat.sessionId);
      const sessionId = await runtime.createSession(runtime.workspaceId);
      if (!sessionId) throw new Error(t("agents.open_failed"));
      useAgentChatStore.getState().open({
        organizationId: runtime.organizationId,
        workspaceId: runtime.workspaceId,
        sessionId,
        ...(row?.agentId ? { agentId: row.agentId, agentName: row.name } : {}),
      });
      if (row?.name) runtime.renameSession(runtime.workspaceId, sessionId, row.name);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("agents.open_failed")),
  });
  if (!runtime) return null;

  const active = (agents ?? []).filter((item) => item.agent.state === "active");
  const known = new Set(active.map((item) => item.agent.id));
  const rows: AgentRow[] = [
    ...active.map((item) => ({
      key: item.agent.id,
      name: item.agent.name,
      agentId: item.agent.id,
      chat: agentChatForAgent(chats, runtime.organizationId, item.agent.id),
      working: (routines?.get(item.agent.id) ?? []).some((routine) => isActiveRun(routine.latestRun)),
    })),
    ...Object.values(chats)
      .filter((chat) => chat.organizationId === runtime.organizationId && (chat.agentId === null || (agents === undefined && !known.has(chat.agentId))))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((chat) => ({ key: chat.sessionId, name: chat.agentName, agentId: chat.agentId, chat, working: false })),
  ];

  return (
    <SidebarGroup data-agents-section className="pb-0 pt-4">
      <SidebarGroupContent>
        <div className="flex h-6 items-center pe-2 ps-2.5">
          <span className="text-[11px] font-light text-muted-foreground">{t("agents.section")}</span>
          <button
            type="button"
            data-agents-new
            className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={open.isPending}
            onClick={() => open.mutate(null)}
            aria-label={t("agents.new_label")}
            title={t("agents.new_label")}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <SidebarMenu>
          {rows.map((row) => (
            <SidebarMenuItem key={row.key}>
              <SidebarMenuButton
                type="button"
                data-agent-row={row.agentId ?? "new"}
                data-agent-name={row.name ?? ""}
                isActive={row.chat !== null && row.chat.sessionId === runtime.selectedSessionId}
                tooltip={row.name ?? t("agents.new")}
                onClick={() => open.mutate(row)}
              >
                <AgentFace name={row.name} />
                <span className="truncate">{row.name ?? t("agents.new")}</span>
                {row.working ? <span role="status" aria-label={t("agents.row_working")} className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-blue-9" /> : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
