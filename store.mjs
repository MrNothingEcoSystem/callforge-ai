/**
 * CALLFORGE AI — SQLite Persistence Layer
 * v0.2 Simulation Baseline
 *
 * Provides tenant-scoped data persistence with migrations,
 * idempotency constraints, and transaction integrity.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const DB_DIR = process.env.CALLFORGE_DB_DIR || join(process.cwd(), 'data');
let databasePath = process.env.CALLFORGE_DB_PATH || join(DB_DIR, 'callforge.db');

let db = null;

export function setTestDatabasePath(path) {
  if (db) {
    throw new Error(
      'Cannot change database path while database is initialized. Call closeStore() first.',
    );
  }
  databasePath = path;
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export async function initDatabase() {
  if (db) {
    return db;
  }

  // Ensure data directory exists
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(databasePath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  await runMigrations(db);

  // Prepare statements
  prepareStatements(db);

  return db;
}

async function runMigrations(db) {
  const migrations = [
    // Migration 1: Core tables
    `
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      settings TEXT DEFAULT '{}',
      compliance_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `,

    // Migration 2: Call intent and simulation tables
    `
    CREATE TABLE IF NOT EXISTS call_intents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      from_number TEXT,
      to_number TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dispatched', 'completed', 'failed', 'cancelled')),
      language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('ar', 'en')),
      voice_config TEXT DEFAULT '{}',
      business_context TEXT DEFAULT '{}',
      compliance_evidence TEXT DEFAULT '{}',
      approval_id TEXT,
      approval_expires_at TEXT,
      dispatched_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_call_intents_idempotency ON call_intents(tenant_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_call_intents_tenant ON call_intents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_call_intents_status ON call_intents(status);
    `,

    // Migration 3: Call events and audit
    `
    CREATE TABLE IF NOT EXISTS call_events (
      id TEXT PRIMARY KEY,
      call_intent_id TEXT NOT NULL REFERENCES call_intents(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      provider_event_id TEXT,
      provider_name TEXT,
      sequence_number INTEGER NOT NULL DEFAULT 0,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_call_events_intent ON call_events(call_intent_id);
    CREATE INDEX IF NOT EXISTS idx_call_events_sequence ON call_events(call_intent_id, sequence_number);
    `,

    // Migration 4: Audit events (hash-linked)
    `
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'agent', 'provider')),
      actor_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      payload TEXT DEFAULT '{}',
      previous_hash TEXT,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_hash ON audit_events(event_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
    `,

    // Migration 5: Business configuration
    `
    CREATE TABLE IF NOT EXISTS business_configs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sector TEXT,
      business_name TEXT,
      license_number TEXT,
      license_expiry TEXT,
      supported_languages TEXT DEFAULT '["en"]',
      calling_hours TEXT DEFAULT '{"start": "09:00", "end": "21:00", "timezone": "Asia/Dubai"}',
      max_retries INTEGER DEFAULT 3,
      retry_cooldown_hours INTEGER DEFAULT 24,
      ai_disclosure_enabled INTEGER DEFAULT 1,
      recording_consent_required INTEGER DEFAULT 1,
      dncr_check_enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id)
    );
    `,

    // Migration 6: Knowledge base
    `
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('ar', 'en')),
      tags TEXT DEFAULT '[]',
      embedding TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge_entries(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_language ON knowledge_entries(language);
    `,

    // Migration 7: Conversation fixtures (deterministic)
    `
    CREATE TABLE IF NOT EXISTS conversation_fixtures (
      id TEXT PRIMARY KEY,
      language TEXT NOT NULL CHECK (language IN ('ar', 'en')),
      scenario TEXT NOT NULL,
      turns TEXT NOT NULL,
      expected_outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
  ];

  for (const migration of migrations) {
    db.exec(migration);
  }

  seedConversationFixtures(db);
}

function seedConversationFixtures(db) {
  const fixtures = [
    {
      id: 'fixture-en-appointment-booking',
      language: 'en',
      scenario: 'appointment_booking',
      turns: [
        {
          role: 'agent',
          text: 'Hello! Thank you for calling Dubai Dental Clinic. How can I help you today?',
        },
        { role: 'user', text: "Hi, I'd like to book a teeth cleaning appointment." },
        { role: 'agent', text: 'I can help with that request. What day and time do you prefer?' },
      ],
      expectedOutcome: 'appointment_booked',
    },
    {
      id: 'fixture-ar-appointment-booking',
      language: 'ar',
      scenario: 'appointment_booking',
      turns: [
        {
          role: 'agent',
          text: 'مرحباً! شكراً لاتصالك بعيادة دبي للأسنان. كيف يمكنني مساعدتك اليوم؟',
        },
        { role: 'user', text: 'أهلاً، أود حجز موعد لتنظيف الأسنان.' },
        { role: 'agent', text: 'يمكنني مساعدتك في طلب الموعد. ما اليوم والوقت المناسبان لك؟' },
      ],
      expectedOutcome: 'appointment_booked',
    },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO conversation_fixtures (id, language, scenario, turns, expected_outcome)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const fixture of fixtures) {
    insert.run(
      fixture.id,
      fixture.language,
      fixture.scenario,
      JSON.stringify(fixture.turns),
      fixture.expectedOutcome,
    );
  }
}

function prepareStatements(db) {
  // Tenant statements
  db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)');
  db.prepare('SELECT * FROM tenants WHERE id = ?');
  db.prepare('SELECT * FROM tenants WHERE domain = ?');
  db.prepare("UPDATE tenants SET settings = ?, updated_at = datetime('now') WHERE id = ?");

  // User statements
  db.prepare('INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)');
  db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?');

  // API key statements
  db.prepare(
    'INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.prepare('SELECT * FROM api_keys WHERE key_hash = ?');
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?");

  // Call intent statements
  db.prepare(`
    INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, from_number, to_number, language, voice_config, business_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.prepare('SELECT * FROM call_intents WHERE tenant_id = ? AND idempotency_key = ?');
  db.prepare('SELECT * FROM call_intents WHERE id = ?');
  db.prepare("UPDATE call_intents SET status = ?, updated_at = datetime('now') WHERE id = ?");
  db.prepare(
    "UPDATE call_intents SET approval_id = ?, approval_expires_at = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
  );
  db.prepare(
    "UPDATE call_intents SET dispatched_at = datetime('now'), status = ?, updated_at = datetime('now') WHERE id = ?",
  );
  db.prepare(
    "UPDATE call_intents SET completed_at = datetime('now'), status = ?, updated_at = datetime('now') WHERE id = ?",
  );

  // Call events
  db.prepare(`
    INSERT INTO call_events (id, call_intent_id, event_type, payload, provider_event_id, provider_name, sequence_number, previous_event_hash, event_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.prepare('SELECT * FROM call_events WHERE call_intent_id = ? ORDER BY sequence_number');

  // Audit events
  db.prepare(`
    INSERT INTO audit_events (id, tenant_id, event_type, actor_type, actor_id, action, resource_type, resource_id, payload, previous_hash, event_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Business config
  db.prepare(`
    INSERT INTO business_configs (id, tenant_id, sector, business_name, license_number, license_expiry, supported_languages, calling_hours, max_retries, retry_cooldown_hours, ai_disclosure_enabled, recording_consent_required, dncr_check_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.prepare('SELECT * FROM business_configs WHERE tenant_id = ?');
  db.prepare(
    "UPDATE business_configs SET sector = ?, business_name = ?, license_number = ?, license_expiry = ?, supported_languages = ?, calling_hours = ?, max_retries = ?, retry_cooldown_hours = ?, ai_disclosure_enabled = ?, recording_consent_required = ?, dncr_check_enabled = ?, updated_at = datetime('now') WHERE tenant_id = ?",
  );

  // Knowledge entries
  db.prepare(
    'INSERT INTO knowledge_entries (id, tenant_id, title, content, language, tags) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.prepare('SELECT * FROM knowledge_entries WHERE tenant_id = ? AND language = ?');
  db.prepare('SELECT * FROM knowledge_entries WHERE tenant_id = ? AND id = ?');

  // Conversation fixtures
  db.prepare(
    'INSERT INTO conversation_fixtures (id, language, scenario, turns, expected_outcome) VALUES (?, ?, ?, ?, ?)',
  );
  db.prepare('SELECT * FROM conversation_fixtures WHERE language = ? AND scenario = ?');
}

export async function closeStore() {
  if (db) {
    db.close();
    db = null;
  }
}

// Utility functions
export function generateId() {
  return uuidv4();
}

export function nowISO() {
  return new Date().toISOString();
}

export async function hashEvent(event) {
  const crypto = await import('crypto');
  // Sort top-level keys deterministically without affecting nested objects
  const sortedKeys = Object.keys(event).sort();
  const sortedEvent = {};
  for (const key of sortedKeys) {
    sortedEvent[key] = event[key];
  }
  const content = JSON.stringify(sortedEvent);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function hashEventAsync(event) {
  const crypto = await import('crypto');
  // Sort top-level keys deterministically without affecting nested objects
  const sortedKeys = Object.keys(event).sort();
  const sortedEvent = {};
  for (const key of sortedKeys) {
    sortedEvent[key] = event[key];
  }
  const content = JSON.stringify(sortedEvent);
  return crypto.createHash('sha256').update(content).digest('hex');
}
