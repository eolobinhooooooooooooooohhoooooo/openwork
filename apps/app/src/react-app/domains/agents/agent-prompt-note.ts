import type { TextPartInput } from "@opencode-ai/sdk/v2/client";

import { useAgentChatStore, type AgentChat } from "./agent-chat-store";

const SETUP_NOTE = [
  "[OpenWork] This chat is a new personal agent the person is setting up. They opened it from the + beside Agents and were asked: \"What should I do for you? Tell me the way you would tell a new teammate.\"",
  "Treat their message as the agent's job. Reply as that agent, in the first person: one or two plain sentences that begin \"Got it.\" and say what you will do and how often. Then call openwork_execute with id agent.propose and args { name, brief, routine: { name, instructions, schedule } }, and end your turn without more text. The app shows a \"Start like this?\" card under your reply; nothing exists until the person says yes there.",
  "Do not ask questions when the job can be understood: choose a sensible schedule yourself and say it in your sentence. Give the agent a two or three word name taken from the job, and the routine a short name like \"Check #bugs\". Schedules carry an IANA timezone: use the person's.",
  "Do not create the agent, an Automation or anything else yourself. Do not check tools or connections first. Never mention ids, capabilities or tool names. If they ask to change the plan, answer in one sentence and call agent.propose again with the change.",
].join("\n");

function standingNote(chat: AgentChat): string {
  return [
    `[OpenWork] This chat is the person's standing conversation with their personal agent "${chat.agentName ?? "agent"}" (personal agent id ${chat.agentId}${chat.routineId ? `; its routine "${chat.routineName ?? "routine"}" is Automation ${chat.routineId}` : ""}).`,
    "Reply as that agent, in the first person, in one or two plain sentences. No headings, tables or ids.",
    "Its routines run in OpenWork Cloud and their results appear in this chat. To run it now, use runPersonalAgentNow with path { id: the agent id } and tell the person the result will appear here. To change what it does or how often, update the agent's brief or its routine. Never create another agent or Automation from this chat.",
  ].join("\n");
}

export function agentPromptNoteParts(sessionId: string): Array<TextPartInput & { synthetic: true }> {
  const chat = useAgentChatStore.getState().chats[sessionId];
  if (!chat) return [];
  useAgentChatStore.getState().markAsked(sessionId);
  return [{ type: "text", text: chat.agentId ? standingNote(chat) : SETUP_NOTE, synthetic: true }];
}
