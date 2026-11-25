import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const PERSISTED_AGENT_CHAT_STORE_KEY = "openwork:personal-agent-chats:v1";

export type AgentChat = {
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  proposalId: string | null;
  routineId: string | null;
  routineName: string | null;
  firstRunId: string | null;
  chatLinkPending?: boolean;
  asked: boolean;
  createdAt: number;
};

export type AgentChatProgress = Partial<Pick<AgentChat, "agentId" | "agentName" | "proposalId" | "routineId" | "routineName" | "firstRunId" | "chatLinkPending">>;

type AgentChatStore = {
  chats: Record<string, AgentChat>;
  panelSessionId: string | null;
  open: (chat: Pick<AgentChat, "organizationId" | "workspaceId" | "sessionId"> & AgentChatProgress) => void;
  save: (sessionId: string, progress: AgentChatProgress) => void;
  markAsked: (sessionId: string) => void;
  forget: (sessionId: string) => void;
  setPanel: (sessionId: string | null) => void;
};

export const useAgentChatStore = create<AgentChatStore>()(persist((set) => ({
  chats: {},
  panelSessionId: null,
  open: (chat) => set((state) => {
    const existing: AgentChat = state.chats[chat.sessionId] ?? {
      organizationId: chat.organizationId,
      workspaceId: chat.workspaceId,
      sessionId: chat.sessionId,
      agentId: null,
      agentName: null,
      proposalId: null,
      routineId: null,
      routineName: null,
      firstRunId: null,
      asked: false,
      createdAt: Date.now(),
    };
    return { chats: { ...state.chats, [chat.sessionId]: { ...existing, ...chat } } };
  }),
  save: (sessionId, progress) => set((state) => {
    const chat = state.chats[sessionId];
    return chat ? { chats: { ...state.chats, [sessionId]: { ...chat, ...progress } } } : state;
  }),
  markAsked: (sessionId) => set((state) => {
    const chat = state.chats[sessionId];
    return chat && !chat.asked ? { chats: { ...state.chats, [sessionId]: { ...chat, asked: true } } } : state;
  }),
  forget: (sessionId) => set((state) => {
    const { [sessionId]: _removed, ...chats } = state.chats;
    return { chats, panelSessionId: state.panelSessionId === sessionId ? null : state.panelSessionId };
  }),
  setPanel: (panelSessionId) => set({ panelSessionId }),
}), {
  name: PERSISTED_AGENT_CHAT_STORE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ chats: state.chats }),
}));

export function isStandingChat(chat: AgentChat): boolean {
  return chat.agentId !== null && (chat.routineId !== null || chat.proposalId === null);
}

export function agentChatFor(chats: Record<string, AgentChat>, organizationId: string | null, sessionId: string | null): AgentChat | null {
  if (!organizationId || !sessionId) return null;
  const chat = chats[sessionId];
  return chat && chat.organizationId === organizationId ? chat : null;
}

export function agentChatForAgent(chats: Record<string, AgentChat>, organizationId: string, workspaceId: string, agentId: string): AgentChat | null {
  return Object.values(chats)
    .filter((chat) => chat.organizationId === organizationId && chat.workspaceId === workspaceId && chat.agentId === agentId)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
