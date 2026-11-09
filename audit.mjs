/**
 * CALLFORGE AI — Hash-Linked Audit Logger
 * v0.2 Simulation Baseline
 *
 * Provides immutable audit trail with hash-chaining for
 * tamper-evident logging of all system events.
 */

import { getDatabase, generateId, nowISO, hashEventAsync } from './store.mjs';

async function getChainHead() {
  // Always read from database to ensure fresh state
  const db = getDatabase();
  const lastEvent = db
    .prepare('SELECT event_hash FROM audit_events ORDER BY created_at DESC LIMIT 1')
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
      const db = getDatabase();

      // Ensure chain head is initialized
      if (!currentHead) {
        currentHead = await getChainHead();
      }

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
        previous_hash: currentHead,
        created_at: entry.created_at || nowISO(),
      };

      // Compute hash of this event (including previous hash) - payload as object
      const eventHash = await hashEventAsync({
        ...event,
        previous_hash: currentHead,
      });

      event.event_hash = eventHash;

      // Insert into database - stringify payload for storage
      db.prepare(
        `
        INSERT INTO audit_events (id, tenant_id, event_type, actor_type, actor_id, action, resource_type, resource_id, payload, previous_hash, event_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      // Update chain head
      currentHead = eventHash;

      return event;
    },

    async verifyChain(fromEventId = null) {
      const db = getDatabase();

      let query = 'SELECT * FROM audit_events ORDER BY created_at ASC';
      const params = [];

      if (fromEventId) {
        query =
          'SELECT * FROM audit_events WHERE created_at >= (SELECT created_at FROM audit_events WHERE id = ?) ORDER BY created_at ASC';
        params.push(fromEventId);
      }

      const events = db.prepare(query).all(...params);

      let previousHash = '0'.repeat(64);
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

        // Skip genesis previous_hash check (first event with previous_hash = '0'.repeat(64))
        if (event.id === events[0]?.id && event.previous_hash === '0'.repeat(64)) {
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

      return { valid, errors, events_checked: events.length, chain_head: previousHash };
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
        ORDER BY created_at DESC
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
