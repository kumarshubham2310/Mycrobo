import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

function sameFingerprint(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseRecord(row) {
  if (!row) return null;
  return Object.freeze({
    authorizationId: row.authorization_id,
    idempotencyKey: row.idempotency_key,
    bindingFingerprint: row.binding_fingerprint,
    encodedPayload: row.encoded_payload,
    tokenHash: row.token_hash,
    expiresAtMs: Number(row.expires_at_ms),
    status: row.status,
    intent: row.intent_json ? Object.freeze(JSON.parse(row.intent_json)) : undefined,
    delivery: row.delivery_json ? Object.freeze(JSON.parse(row.delivery_json)) : undefined,
  });
}

/**
 * Transactional local send-capability ledger. It stores bindings and hashes,
 * never a message body, and remains authoritative across gateway restarts.
 */
export class SqliteAutoSendAuthorizationLedger {
  constructor(databasePath) {
    if (!databasePath) throw new Error("An authorization ledger database path is required.");
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      pragma journal_mode = WAL;
      pragma synchronous = FULL;
      pragma secure_delete = ON;
    `);
    const columns = this.database.prepare("pragma table_info(auto_send_authorizations)").all().map((column) => column.name);
    if (columns.length && !columns.includes("token") && !columns.includes("encoded_payload")) {
      throw new Error("The authorization ledger schema is not recognized.");
    }
    if (columns.includes("token")) {
      this.database.exec(`
        begin immediate;
        create table auto_send_authorizations_v2 (
          authorization_id text primary key,
          idempotency_key text not null unique,
          binding_fingerprint text not null,
          encoded_payload text not null,
          token_hash text not null,
          expires_at_ms integer not null,
          status text not null check (status in ('issued', 'consumed', 'delivered')),
          intent_json text,
          delivery_json text
        ) strict;
        insert into auto_send_authorizations_v2 (
          authorization_id, idempotency_key, binding_fingerprint, encoded_payload,
          token_hash, expires_at_ms, status, intent_json, delivery_json
        )
        select authorization_id, idempotency_key, binding_fingerprint,
               case when instr(token, '.') > 0 then substr(token, 1, instr(token, '.') - 1) else '' end,
               token_hash, expires_at_ms, status, intent_json, delivery_json
          from auto_send_authorizations;
        drop table auto_send_authorizations;
        alter table auto_send_authorizations_v2 rename to auto_send_authorizations;
        commit;
        pragma wal_checkpoint(TRUNCATE);
        vacuum;
      `);
    }
    this.database.exec(`
      create table if not exists auto_send_authorizations (
        authorization_id text primary key,
        idempotency_key text not null unique,
        binding_fingerprint text not null,
        encoded_payload text not null,
        token_hash text not null,
        expires_at_ms integer not null,
        status text not null check (status in ('issued', 'consumed', 'delivered')),
        intent_json text,
        delivery_json text
      ) strict;
      create index if not exists auto_send_authorizations_expiry
        on auto_send_authorizations(expires_at_ms);
    `);
    this.byIdempotency = this.database.prepare(
      "select * from auto_send_authorizations where idempotency_key = ?",
    );
    this.byAuthorization = this.database.prepare(
      "select * from auto_send_authorizations where authorization_id = ?",
    );
    this.insert = this.database.prepare(`
      insert into auto_send_authorizations (
        authorization_id, idempotency_key, binding_fingerprint, encoded_payload,
        token_hash, expires_at_ms, status, intent_json
      ) values (?, ?, ?, ?, ?, ?, 'issued', null)
    `);
    this.markConsumed = this.database.prepare(`
      update auto_send_authorizations
         set status = 'consumed', intent_json = ?
       where authorization_id = ? and token_hash = ? and status = 'issued'
    `);
    this.markDelivered = this.database.prepare(`
      update auto_send_authorizations
         set status = 'delivered', delivery_json = ?
       where authorization_id = ? and status = 'consumed'
         and json_extract(intent_json, '$.executionId') = ?
    `);
    this.deleteExpired = this.database.prepare(
      "delete from auto_send_authorizations where expires_at_ms <= ? and status = 'issued'",
    );
  }

  #transaction(callback) {
    this.database.exec("begin immediate");
    try {
      const result = callback();
      this.database.exec("commit");
      return result;
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }

  reserve(record) {
    return this.#transaction(() => {
      const prior = parseRecord(this.byIdempotency.get(record.idempotencyKey));
      if (prior) return prior;
      this.insert.run(
        record.authorizationId,
        record.idempotencyKey,
        record.bindingFingerprint,
        record.encodedPayload,
        record.tokenHash,
        record.expiresAtMs,
      );
      return parseRecord(this.byAuthorization.get(record.authorizationId));
    });
  }

  findByAuthorizationId(authorizationId) {
    return parseRecord(this.byAuthorization.get(authorizationId));
  }

  consume(authorizationId, tokenHash, intent) {
    return this.#transaction(() => {
      const record = parseRecord(this.byAuthorization.get(authorizationId));
      if (!record || !sameFingerprint(record.tokenHash, tokenHash)) {
        throw new Error("Authorization token is not present in the active send ledger.");
      }
      if (record.status === "consumed" || record.status === "delivered") {
        if (record.intent?.executionId !== intent.executionId) {
          throw new Error(record.status === "delivered" ? "Authorization token was already delivered." : "Authorization token was already consumed.");
        }
        return record.intent;
      }
      const result = this.markConsumed.run(JSON.stringify(intent), authorizationId, tokenHash);
      if (result.changes !== 1) throw new Error("Authorization token was already consumed.");
      return intent;
    });
  }

  complete(authorizationId, executionId, delivery) {
    return this.#transaction(() => {
      const record = parseRecord(this.byAuthorization.get(authorizationId));
      if (!record?.intent || record.intent.executionId !== executionId) {
        throw new Error("Only the consuming execution can complete this delivery.");
      }
      if (record.status === "delivered") {
        if (!record.delivery || record.delivery.receiptFingerprint !== delivery.receiptFingerprint) {
          throw new Error("Delivery completion conflicts with the recorded receipt.");
        }
        return record.delivery;
      }
      if (record.status !== "consumed") throw new Error("Authorization must be consumed before delivery completion.");
      const result = this.markDelivered.run(JSON.stringify(delivery), authorizationId, executionId);
      if (result.changes !== 1) throw new Error("Delivery completion could not be committed atomically.");
      return delivery;
    });
  }

  prune(nowMs) {
    this.deleteExpired.run(nowMs);
  }

  close() {
    this.database.close();
  }
}
