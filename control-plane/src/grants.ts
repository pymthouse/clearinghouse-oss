import type { Sql } from "postgres";
import type { ClearinghouseActor } from "./auth.js";
import { recordAuditEvent } from "./audit.js";

export interface IssueGrantInput {
  issuer: string;
  clientId: string;
  usageSubject: string;
  usageSubjectType: string;
  amountWei: string;
  reason?: string;
}

export async function issueGrant(
  sql: Sql,
  actor: ClearinghouseActor,
  input: IssueGrantInput,
): Promise<{ id: string }> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO signer_credit_grants (
      issuer,
      client_id,
      usage_subject,
      usage_subject_type,
      amount_wei,
      reason,
      issued_by_actor_type,
      issued_by_actor_id
    )
    VALUES (
      ${input.issuer},
      ${input.clientId},
      ${input.usageSubject},
      ${input.usageSubjectType},
      ${input.amountWei},
      ${input.reason ?? null},
      ${actor.type},
      ${actor.clientId}
    )
    RETURNING id::text AS id
  `;

  await recordAuditEvent(sql, actor, "grant.issue", "grant", row.id, { ...input });

  return row;
}
