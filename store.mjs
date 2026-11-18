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
import { runMigrations } from './db/migrate.mjs';

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
  db.pragma('busy_timeout = 5000');

  // Versioned migrations (M03-1); seeds fixtures only when empty.
  runMigrations(db);
  seedConversationFixtures(db);

  return db;
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

export function withTransaction(fn) {
  const database = getDatabase();
  return database.transaction(fn)();
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
