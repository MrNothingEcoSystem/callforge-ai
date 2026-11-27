/**
 * Test fixture: one dispatcher process lifecycle for the TECH-005 two-cycle
 * crash-recovery proof. Each invocation is a separate OS process (a "cycle").
 *
 * modes:
 *   produce  — enqueue N `test.apply` rows + one `webhook.received` row
 *   crash    — dispatch, then hard-exit after the first applied effect and
 *              BEFORE the outbox ack (process.exit, no cleanup: a real crash)
 *   recover  — run runRecovery() and print the result as JSON
 *   drain    — dispatch until empty, print the result as JSON
 *   verify   — print row statuses and effect counts as JSON
 *
 * The effect is INSERT OR IGNORE into crash_effects keyed by outbox id, so a
 * redelivery is visible (attempts > 1) while the effect stays exactly-once.
 */
import { setTestDatabasePath, initDatabase, closeStore } from '../../store.mjs';
import { enqueue } from '../../workflow/outbox.mjs';
import { receiveWebhook } from '../../workflow/webhookInbox.mjs';
import { createDispatcher } from '../../workflow/dispatcher.mjs';
import { runRecovery } from '../../workflow/recovery.mjs';

const [dbPath, mode, countArg] = process.argv.slice(2);
setTestDatabasePath(dbPath);
const db = await initDatabase();

db.exec(`CREATE TABLE IF NOT EXISTS crash_effects (
  outbox_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

process.env.OUTBOX_DISPATCHER_ENABLED = '1';

function applyEffect(db, row) {
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO crash_effects (outbox_id) VALUES (?)').run(row.id);
  })();
}

if (mode === 'produce') {
  const count = Number(countArg || 3);
  receiveWebhook(db, { provider: 'crash', rawBody: '{"crash":1}' });
  for (let i = 0; i < count; i++) {
    enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: `crash-${i}`,
      type: 'test.apply',
    });
  }
  console.log(JSON.stringify({ outbox: db.prepare('SELECT COUNT(*) n FROM outbox').get().n }));
} else if (mode === 'crash') {
  // Crash on the FIRST claimed row (whichever type): die after the effect and
  // before the ack, so the row stays claimed with a live lease.
  const dispatcher = createDispatcher(db, {
    handlers: {
      'test.apply': async (db, row) => {
        applyEffect(db, row);
        process.exit(9);
      },
      'webhook.received': async (db, row) => {
        db.prepare("UPDATE webhook_inbox SET status = 'processing' WHERE id = ?").run(
          row.aggregate_id,
        );
        process.exit(9);
      },
    },
  });
  await dispatcher.dispatchOnce();
  console.log(JSON.stringify({ survived: true }));
} else if (mode === 'recover') {
  console.log(JSON.stringify(runRecovery(db)));
} else if (mode === 'drain') {
  const dispatcher = createDispatcher(db, {
    handlers: { 'test.apply': async (db, row) => applyEffect(db, row) },
  });
  let acked = 0;
  let rounds = 0;
  for (;;) {
    const res = await dispatcher.dispatchOnce();
    acked += res.acked;
    if (res.claimed === 0 || ++rounds > 20) {
      break;
    }
  }
  console.log(JSON.stringify({ acked }));
} else if (mode === 'verify') {
  console.log(
    JSON.stringify({
      outbox: db.prepare('SELECT status, attempts FROM outbox ORDER BY aggregate_id').all(),
      effects: db.prepare('SELECT COUNT(*) n FROM crash_effects').get().n,
      webhook: db.prepare('SELECT status FROM webhook_inbox').all(),
    }),
  );
}
await closeStore();
