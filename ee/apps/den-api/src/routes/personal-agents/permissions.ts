import type { Hono, MiddlewareHandler } from "hono"
import type { OrganizationContextVariables } from "../../middleware/index.js"
import type { AuthContextVariables } from "../../session.js"

type RouteVariables = Partial<OrganizationContextVariables> & Partial<Pick<AuthContextVariables, "session">>

export function registerPersonalAgentPermissionsRoutes<T extends { Variables: RouteVariables }>(app: Hono<T>, gate: MiddlewareHandler): void {
  void app
  void gate
}
