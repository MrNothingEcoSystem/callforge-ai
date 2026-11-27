/**
 * CALLFORGE AI — Hash-Linked Audit Logger
 * v0.2 Simulation Baseline
 *
 * Provides immutable audit trail with hash-chaining for
 * tamper-evident logging of all system events.
 */

import { getDatabase, generateId, nowISO, hashEventAsync } from './store.mjs';

let appendQueue = Promise.resolve();

async function getChainHead() {
  // Always read from database to ensure fresh state
  const db = getDatabase();
  const lastEvent = db
    .prepare('SELECT event_hash FROM audit_events ORDER BY seq DESC LIMIT 1')
    .get();

  if (lastEvent) {
    return lastEvent.event_hash;
  } else {
    // Genesis hash
    return '0'.repeat(64);
  }
}

export function createAuditLogger() {
  let currentHead = null;

  return {
    async initialize() {
      currentHead = await getChainHead();
    },

    async log(entry) {
      const append = async () => {
        const db = getDatabase();
        const previousHash = await getChainHead();

        const event = {
          id: entry.id || generateId(),
          tenant_id: entry.tenant_id || null,
          event_type: entry.event_type,
          actor_type: entry.actor_type || 'system',
          actor_id: entry.actor_id || null,
          action: entry.action || 'unknown',
          resource_type: entry.resource_type || null,
          resource_id: entry.resource_id || null,
          payload: entry.payload || {},
          previous_hash: previousHash,
          created_at: entry.created_at || nowISO(),
        };

        const eventHash = await hashEventAsync(event);
        event.event_hash = eventHash;

        db.prepare(
          `
          INSERT INTO audit_events (id, tenant_id, event_type, actor_type, actor_id, action, resource_type, resource_id, payload, previous_hash, event_hash, created_at, seq)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1 FROM audit_events
        `,
        ).run(
          event.id,
          event.tenant_id,
          event.event_type,
          event.actor_type,
          event.actor_id,
          event.action,
          event.resource_type,
          event.resource_id,
          JSON.stringify(event.payload),
          event.previous_hash,
          event.event_hash,
          event.created_at,
        );

        currentHead = eventHash;
        return event;
      };

      const result = appendQueue.then(append, append);
      appendQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    async verifyChain(fromEventId = null) {
      const db = getDatabase();

      let query = 'SELECT * FROM audit_events ORDER BY seq ASC';
      const params = [];

      if (fromEventId) {
        query =
          'SELECT * FROM audit_events WHERE seq >= (SELECT seq FROM audit_events WHERE id = ?) ORDER BY seq ASC';
        params.push(fromEventId);
      }

      const events = db.prepare(query).all(...params);

      const GENESIS = '0'.repeat(64);

      // An unknown start id yields an empty range; report it rather than
      // silently returning "valid" for zero events (review R2).
      if (fromEventId && events.length === 0) {
        return {
          valid: false,
          anchored: false,
          warnings: [],
          errors: [{ event_id: fromEventId, error: 'Unknown start event' }],
          events_checked: 0,
          chain_head: GENESIS,
        };
      }

      // Anchored means the oldest stored event still carries the genesis
      // sentinel, i.e. no prefix has been archived or deleted. A truncated head
      // is reported as an unanchored segment instead of a false chain break
      // (issue #190 / review R1). Full archival still needs a checkpoint policy.
      const root = db
        .prepare('SELECT previous_hash FROM audit_events ORDER BY seq ASC LIMIT 1')
        .get();
      const anchored = root ? root.previous_hash === GENESIS : true;
      const warnings = [];

      // Seed from the actual predecessor when starting mid-chain (issue #2);
      // genesis only when the range really starts at the chain root.
      let previousHash = GENESIS;
      if (!anchored && events.length > 0) {
        previousHash = events[0].previous_hash;
        warnings.push({
          event_id: events[0].id,
          warning:
            'Chain head is unanchored: earlier events are missing, segment verified from its first available event',
        });
      }
      if (fromEventId && events.length > 0) {
        const predecessor = db
          .prepare(
            'SELECT event_hash FROM audit_events WHERE seq < (SELECT seq FROM audit_events WHERE id = ?) ORDER BY seq DESC LIMIT 1',
          )
          .get(fromEventId);
        if (predecessor) {
          previousHash = predecessor.event_hash;
        }
      }
      let valid = true;
      const errors = [];

      for (const event of events) {
        // Verify event hash for all events
        const computedHash = await hashEventAsync({
          id: event.id,
          tenant_id: event.tenant_id,
          event_type: event.event_type,
          actor_type: event.actor_type,
          actor_id: event.actor_id,
          action: event.action,
          resource_type: event.resource_type,
          resource_id: event.resource_id,
          payload: JSON.parse(event.payload || '{}'),
          previous_hash: event.previous_hash,
          created_at: event.created_at,
        });

        if (computedHash !== event.event_hash) {
          valid = false;
          errors.push({
            event_id: event.id,
            error: 'Event hash mismatch',
            expected_hash: computedHash,
            actual_hash: event.event_hash,
          });
        }

        // Skip the previous_hash check only for the first checked event when it
        // carries the genesis sentinel; a mid-chain event claiming genesis is a
        // forgery attempt and must still be link-checked.
        if (event === events[0] && event.previous_hash === GENESIS) {
          previousHash = event.event_hash;
          continue;
        }

        // Verify previous hash link
        if (event.previous_hash !== previousHash) {
          valid = false;
          errors.push({
            event_id: event.id,
            error: 'Hash chain broken',
            expected_previous: previousHash,
            actual_previous: event.previous_hash,
          });
        }

        previousHash = event.event_hash;
      }

      return {
        valid,
        anchored,
        warnings,
        errors,
        events_checked: events.length,
        chain_head: previousHash,
      };
    },

    async getEvents(filters = {}) {
      const db = getDatabase();

      let where = '1=1';
      const params = [];

      if (filters.tenant_id) {
        where += ' AND tenant_id = ?';
        params.push(filters.tenant_id);
      }

      if (filters.event_type) {
        where += ' AND event_type = ?';
        params.push(filters.event_type);
      }

      if (filters.actor_type) {
        where += ' AND actor_type = ?';
        params.push(filters.actor_type);
      }

      if (filters.from_date) {
        where += ' AND created_at >= ?';
        params.push(filters.from_date);
      }

      if (filters.to_date) {
        where += ' AND created_at <= ?';
        params.push(filters.to_date);
      }

      const limit = filters.limit || 100;
      const offset = filters.offset || 0;

      const events = db
        .prepare(
          `
        SELECT * FROM audit_events
        WHERE ${where}
        ORDER BY seq DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(...params, limit, offset);

      return events.map(e => ({
        ...e,
        payload: JSON.parse(e.payload || '{}'),
      }));
    },

    getChainHead() {
      return currentHead;
    },
  };
}

export { getChainHead };
