import { relations, sql } from "drizzle-orm"
import { bigint, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import type { PersonalAgentToolPolicy } from "@openwork/types/den/personal-agents"
import { compatJsonColumn, denTypeIdColumn, encryptedMediumTextColumn, timestamps } from "../columns"

/**
 * A member's own agent. The definition lives in its revisions, so a routine
 * (an Automation with `agent_id`) can pin the exact brief and tool policy it
 * runs with.
 */
export const PersonalAgentTable = mysqlTable(
  "personal_agent",
  {
    id: denTypeIdColumn("personalAgent", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    owner_member_id: denTypeIdColumn("member", "owner_member_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    state: mysqlEnum("state", ["active", "archived"]).notNull().default("active"),
    current_revision_id: denTypeIdColumn("personalAgentRevision", "current_revision_id").notNull(),
    archived_at: timestamp("archived_at", { fsp: 3 }),
    ...timestamps,
  },
  (table) => [
    index("personal_agent_org_owner_state").on(table.organization_id, table.owner_member_id, table.state),
  ],
)

export const PersonalAgentRevisionTable = mysqlTable(
  "personal_agent_revision",
  {
    id: denTypeIdColumn("personalAgentRevision", "id").notNull().primaryKey(),
    agent_id: denTypeIdColumn("personalAgent", "agent_id").notNull(),
    version: int("version").notNull(),
    brief: encryptedMediumTextColumn("brief").notNull(),
    tool_policy: compatJsonColumn<PersonalAgentToolPolicy>("tool_policy").notNull(),
    default_execution_target: mysqlEnum("default_execution_target", ["desktop", "cloud"]).notNull().default("cloud"),
    monthly_budget_micros: bigint("monthly_budget_micros", { mode: "number", unsigned: true }),
    digest: varchar("digest", { length: 128 }).notNull(),
    created_at: timestamp("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex("personal_agent_revision_version").on(table.agent_id, table.version),
  ],
)

export const personalAgentRelations = relations(PersonalAgentTable, ({ one, many }) => ({
  currentRevision: one(PersonalAgentRevisionTable, {
    fields: [PersonalAgentTable.current_revision_id],
    references: [PersonalAgentRevisionTable.id],
  }),
  revisions: many(PersonalAgentRevisionTable),
}))

export const personalAgentRevisionRelations = relations(PersonalAgentRevisionTable, ({ one }) => ({
  agent: one(PersonalAgentTable, {
    fields: [PersonalAgentRevisionTable.agent_id],
    references: [PersonalAgentTable.id],
  }),
}))
