import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { t } from "@/i18n";

import { resolveAgentChatSession } from "./agent-chat-session";
import { agentChatForAgent, useAgentChatStore, type AgentChat } from "./agent-chat-store";
import { AgentFace } from "./agent-face";
import { firstName } from "./agent-words";
import { useAgentsRuntime } from "./agents-runtime";
import { isActiveRun, useAgentListQuery } from "./use-agents";

type AgentRow = {
  key: string;
  name: string | null;
  agentId: string | null;
  chat: AgentChat | null;
  ownerName?: string;
  needsAttention?: boolean;
  working?: boolean;
};

function unusedDraft(chats: Record<string, AgentChat>, organizationId: string, workspaceId: string): AgentChat | null {
  return Object.values(chats).find((chat) => chat.organizationId === organizationId && chat.workspaceId === workspaceId && !chat.agentId && !chat.asked) ?? null;
}

export function AgentSidebarSection() {
  const runtime = useAgentsRuntime();
  const chats = useAgentChatStore((state) => state.chats);
  const agents = useAgentListQuery(runtime).data;
  const open = useMutation({
    mutationFn: async (row: AgentRow | null) => {
      if (!runtime) return;
      const { organizationId, workspaceId, client } = runtime;
      const store = useAgentChatStore.getState();
      const agentId = row?.agentId;
      if (agentId) {
        const chat = agentChatForAgent(store.chats, organizationId, workspaceId, agentId);
        const { sessionId, source } = await resolveAgentChatSession({
          localSessionId: chat?.sessionId ?? null,
          readPointer: async () => (await client.getPersonalAgentChat(organizationId, agentId, workspaceId)).chat?.sessionId ?? null,
          sessionState: (id) => runtime.sessionState(workspaceId, id),
          createSession: () => runtime.createSession(workspaceId),
        });
        if (!sessionId) throw new Error(t("agents.open_failed"));
        store.open({ organizationId, workspaceId, sessionId, agentId, agentName: row.name });
        if (source === "new") {
          store.save(sessionId, { chatLinkPending: true });
          if (row.name) runtime.renameSession(workspaceId, sessionId, row.name);
        } else {
          runtime.openSession(workspaceId, sessionId);
        }
        if (source === "new" || (source === "local" && chat?.chatLinkPending)) {
          await client.setPersonalAgentChat(organizationId, agentId, { workspaceId, sessionId });
          store.save(sessionId, { chatLinkPending: false });
        }
        return;
      }
      const draft = row?.chat ?? unusedDraft(store.chats, organizationId, workspaceId);
      if (draft) {
        if (await runtime.sessionState(workspaceId, draft.sessionId) !== "gone") return runtime.openSession(workspaceId, draft.sessionId);
        store.forget(draft.sessionId);
        if (row) return;
      }
      const sessionId = await runtime.createSession(workspaceId);
      if (!sessionId) throw new Error(t("agents.open_failed"));
      store.open({ organizationId, workspaceId, sessionId });
    },
    onError: () => toast.error(t("agents.open_failed")),
  });
  if (!runtime) return null;

  const rows: AgentRow[] = [
    ...(agents ?? []).filter((item) => item.agent.state === "active").map((item) => ({
      key: item.agent.id,
      name: item.agent.name,
      agentId: item.agent.id,
      chat: agentChatForAgent(chats, runtime.organizationId, runtime.workspaceId, item.agent.id),
      ownerName: item.role === "owner" ? undefined : firstName(item.owner?.name),
      needsAttention: item.openRequestCount > 0,
      working: item.routines.some((routine) => isActiveRun(routine.latestRun)),
    })),
    ...Object.values(chats)
      .filter((chat) => chat.organizationId === runtime.organizationId && chat.workspaceId === runtime.workspaceId && chat.agentId === null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((chat) => ({ key: chat.sessionId, name: chat.agentName, agentId: null, chat })),
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
                disabled={open.isPending}
                onClick={() => open.mutate(row)}
              >
                <AgentFace name={row.name} />
                <span className="min-w-0 flex-1 truncate">{row.name ?? t("agents.new")}</span>
                {row.ownerName ? <small className="max-w-20 truncate text-[11px] text-muted-foreground">{t("agents.row_from", { name: row.ownerName })}</small> : null}
                {row.needsAttention ? <span role="img" aria-label={t("agents.row_needs_attention")} className="size-1.5 shrink-0 rounded-full bg-amber-9" />
                  : row.working ? <span role="status" aria-label={t("agents.row_working")} className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-9" /> : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
