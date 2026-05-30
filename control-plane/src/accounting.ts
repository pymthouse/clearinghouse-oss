import type { Sql } from "postgres";
import type {
  SignerAccountingStore,
  SignerBalance,
  SignerIdentity,
  CreateSignedTicketEvent,
} from "@pymthouse/builder-sdk/signer/server";
import { createSignedTicketIdempotencyKey } from "@pymthouse/builder-sdk/signer/server";

function weiToString(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value ?? "0");
}

function remainingWei(granted: string, consumed: string): string {
  return (BigInt(granted) - BigInt(consumed)).toString();
}

export class PostgresSignerAccountingStore implements SignerAccountingStore {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async getBalance(identity: SignerIdentity): Promise<SignerBalance> {
    const [row] = await this.sql<[{ granted: string; consumed: string }]>`
      SELECT
        COALESCE(SUM(g.amount_wei), 0)::text AS granted,
        COALESCE((
          SELECT SUM(NULLIF(u.computed_fee_wei, '')::numeric)
          FROM signer_usage_events u
          WHERE u.issuer = ${identity.issuer}
            AND u.client_id = ${identity.clientId}
            AND u.usage_subject = ${identity.usageSubject}
            AND u.usage_subject_type = ${identity.usageSubjectType}
        ), 0)::text AS consumed
      FROM signer_credit_grants g
      WHERE g.issuer = ${identity.issuer}
        AND g.client_id = ${identity.clientId}
        AND g.usage_subject = ${identity.usageSubject}
        AND g.usage_subject_type = ${identity.usageSubjectType}
    `;
    const grantedWei = weiToString(row?.granted);
    const consumedWei = weiToString(row?.consumed);

    return {
      clientId: identity.clientId,
      usageSubject: identity.usageSubject,
      grantedWei,
      consumedWei,
      remainingWei: remainingWei(grantedWei, consumedWei),
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function recordCreateSignedTicketEvent(
  sql: Sql,
  event: CreateSignedTicketEvent,
): Promise<void> {
  await sql`
    INSERT INTO signer_usage_events (
      idempotency_key,
      issuer,
      client_id,
      usage_subject,
      usage_subject_type,
      request_id,
      session_id,
      manifest_id,
      pipeline,
      computed_fee_wei,
      pixels,
      sequence_number,
      occurred_at,
      raw
    )
    VALUES (
      ${createSignedTicketIdempotencyKey(event)},
      ${event.issuer},
      ${event.clientId},
      ${event.usageSubject},
      ${event.usageSubjectType},
      ${event.requestId},
      ${event.sessionId},
      ${event.manifestId ?? null},
      ${event.pipeline ?? null},
      ${event.computedFeeWei ?? null},
      ${event.pixels ?? null},
      ${event.sequenceNumber ?? null},
      ${event.occurredAt},
      ${JSON.stringify(event.raw)}::jsonb
    )
    ON CONFLICT (idempotency_key) DO NOTHING
  `;
}
