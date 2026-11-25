import { createContext, useContext } from "react";

import type { DenClient } from "@/app/lib/den";

export type AgentsRuntime = {
  client: DenClient;
  organizationId: string;
  principalId: string;
  workspaceId: string;
  selectedSessionId: string | null;
  createSession: (workspaceId: string) => Promise<string | null>;
  openSession: (workspaceId: string, sessionId: string) => void;
  sessionState: (workspaceId: string, sessionId: string) => Promise<"open" | "gone" | "unknown">;
  renameSession: (workspaceId: string, sessionId: string, title: string) => void;
};

const AgentsRuntimeContext = createContext<AgentsRuntime | null>(null);

export const PersonalAgentsProvider = AgentsRuntimeContext.Provider;

export function useAgentsRuntime(): AgentsRuntime | null {
  return useContext(AgentsRuntimeContext);
}
