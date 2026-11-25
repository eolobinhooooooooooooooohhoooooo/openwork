import type { SessionGreetingProps } from "@/react-app/kernel/session-extensions";
import { t } from "@/i18n";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { AgentChoices } from "./agent-choices";
import { AgentFace } from "./agent-face";
import { useAgentsRuntime } from "./agents-runtime";

const STARTERS = ["watch", "morning", "follow"] as const;

export function AgentGreeting(props: SessionGreetingProps) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, props.sessionId));
  if (!chat || chat.agentId) return null;
  return (
    <div data-agent-greeting className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-2 pt-6 md:px-10">
      <div className="flex items-start gap-3">
        <AgentFace name={null} className="mt-0.5" />
        <p className="text-[15px] leading-6 text-dls-text">{t("agents.greeting")}</p>
      </div>
      <div className="pl-8">
        <AgentChoices
          choices={[
            ...STARTERS.map((starter) => ({
              id: starter,
              label: t(`agents.starter_${starter}`),
              onSelect: () => props.setPrompt(t(`agents.starter_${starter}_prompt`)),
            })),
            { id: "else", label: t("agents.starter_else"), muted: true, onSelect: () => props.setPrompt("") },
          ]}
        />
      </div>
    </div>
  );
}
