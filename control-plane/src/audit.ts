import type { Sql } from "postgres";
import type { ClearinghouseActor } from "./auth.js";

export async function recordAuditEvent(
  sql: Sql,
  actor: ClearinghouseActor,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const actorId = actor.type === "admin" ? actor.clientId : actor.clientId;
  await sql`
    INSERT INTO clearinghouse_audit_events (
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    VALUES (
      ${actor.type},
      ${actorId},
      ${action},
      ${targetType},
      ${targetId},
      ${JSON.stringify(details)}::jsonb
    )
  `;
}
