import { defineFeature } from "@openwork/features/define"

export default defineFeature({
  label: "Personal agents",
  description: "A member can set up several agents of their own from chat. Each one has a name, instructions, a schedule, the connections it may read or change, and a monthly spending limit. It runs on that schedule in OpenWork Cloud, reports to the member in a Workbot DM, and its spending is tracked on its own. For testing only.",
  category: "workbot",
  added: "2026-11-23",
  since: "2026-11",
  author: "benjaminshafii",
  docs: "docs/features/personal-agents/README.md",
  deployments: ["cloud"],
  default: false,
})
