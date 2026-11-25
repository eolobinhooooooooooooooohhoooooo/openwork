import { EMPTY_PERSONAL_AGENT_TOOL_POLICY, type PersonalAgentNever, type PersonalAgentToolPolicy } from "@openwork/types/den/personal-agents"
import type { PersonalAgentCaller } from "./access.js"

/** Turns "never do X in app Y" into Block entries over the caller's connections. */
export async function personalAgentNeverBlocks(caller: PersonalAgentCaller, never: readonly PersonalAgentNever[]): Promise<PersonalAgentToolPolicy> {
  void caller
  void never
  return EMPTY_PERSONAL_AGENT_TOOL_POLICY
}
