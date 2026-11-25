import type { PersonalAgentCaller } from "./access.js"

/** How many requests wait on the caller, per agent: ones they may decide, or their own that are still open. */
export async function openPersonalAgentRequestCounts(caller: PersonalAgentCaller, agentIds: readonly string[]): Promise<Map<string, number>> {
  void caller
  void agentIds
  return new Map()
}
