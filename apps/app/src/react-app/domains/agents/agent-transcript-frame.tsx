import type { CSSProperties, ReactNode } from "react";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { agentFaceColor, agentFaceLetter } from "./agent-face";
import { useAgentsRuntime } from "./agents-runtime";
import "./agent-transcript.css";

type FaceVariables = CSSProperties & { "--agent-letter": string; "--agent-face": string };

export function AgentTranscriptFrame(props: { sessionId: string; children: ReactNode }) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, props.sessionId));
  if (!chat) return <div className="contents">{props.children}</div>;
  const face: FaceVariables = {
    "--agent-letter": JSON.stringify(agentFaceLetter(chat.agentName)),
    "--agent-face": agentFaceColor(chat.agentName).value,
  };
  return <div data-agent-transcript className="contents" style={face}>{props.children}</div>;
}
