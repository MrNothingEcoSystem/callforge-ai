/**
 * CALLFORGE AI — MCP Tools Registration
 * v0.2 Simulation Baseline
 *
 * Registers all 11 MCP tools for onboarding, configuration,
 * simulation, readiness, call status, reports, and audit access.
 */

import { z } from 'zod';
import { hashEventAsync } from '../store.mjs';

/**
 * Tool 1: Onboard Tenant
 * Creates a new tenant with business configuration
 */
export const onboardTenantSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().min(1).max(255).optional(),
  sector: z
    .enum([
      'professional_services',
      'real_estate',
      'hospitality',
      'clinic',
      'automotive',
      'education',
      'retail',
      'logistics',
      'customer_service',
      'other',
    ])
    .optional(),
  business_name: z.string().max(255).optional(),
  license_number: z.string().max(100).optional(),
  license_expiry: z.string().optional(),
  supported_languages: z.array(z.enum(['ar', 'en'])).default(['en']),
  calling_hours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().default('Asia/Dubai'),
    })
    .optional(),
  admin_email: z.string().email(),
  admin_name: z.string().max(255).optional(),
});

/**
 * Tool 2: Configure Business
 * Updates business configuration for a tenant
 */
export const configureBusinessSchema = z.object({
  tenant_id: z.string().uuid(),
  sector: z
    .enum([
      'professional_services',
      'real_estate',
      'hospitality',
      'clinic',
      'automotive',
      'education',
      'retail',
      'logistics',
      'customer_service',
      'other',
    ])
    .optional(),
  business_name: z.string().max(255).optional(),
  license_number: z.string().max(100).optional(),
  license_expiry: z.string().optional(),
  supported_languages: z.array(z.enum(['ar', 'en'])).optional(),
  calling_hours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string(),
    })
    .optional(),
  max_retries: z.number().int().min(1).max(10).optional(),
  retry_cooldown_hours: z.number().int().min(1).max(168).optional(),
  ai_disclosure_enabled: z.boolean().optional(),
  recording_consent_required: z.boolean().optional(),
  dncr_check_enabled: z.boolean().optional(),
});

/**
 * Tool 3: Simulate Call
 * Creates an idempotent simulated call intent
 */
export const simulateCallSchema = z.object({
  tenant_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(128),
  direction: z.enum(['inbound', 'outbound']),
  from_number: z.string().max(32).optional(),
  to_number: z.string().max(32).optional(),
  language: z.enum(['ar', 'en']).default('en'),
  voice_config: z
    .object({
      voice_id: z.string().optional(),
      speed: z.number().min(0.5).max(2.0).optional(),
      stability: z.number().min(0).max(1).optional(),
    })
    .optional(),
  business_context: z.record(z.string(), z.any()).optional(),
});

/**
 * Tool 4: Simulate Conversation
 * Returns deterministic conversation fixture
 */
export const simulateConversationSchema = z.object({
  language: z.enum(['ar', 'en']),
  scenario: z.enum([
    'appointment_booking',
    'faq_inquiry',
    'lead_qualification',
    'customer_support',
  ]),
});

/**
 * Tool 5: Check Readiness
 * Validates tenant compliance and configuration readiness
 */
export const checkReadinessSchema = z.object({
  tenant_id: z.string().uuid(),
});

/**
 * Tool 6: Get Call Status
 * Retrieves call intent status and event history
 */
export const getCallStatusSchema = z.object({
  tenant_id: z.string().uuid(),
  call_intent_id: z.string().uuid(),
});

/**
 * Tool 7: List Call History
 * Returns paginated call history for a tenant
 */
export const listCallHistorySchema = z.object({
  tenant_id: z.string().uuid(),
  status: z
    .enum(['pending', 'approved', 'rejected', 'dispatched', 'completed', 'failed', 'cancelled'])
    .optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

/**
 * Tool 8: Generate Report
 * Generates analytics report for a tenant
 */
export const generateReportSchema = z.object({
  tenant_id: z.string().uuid(),
  report_type: z.enum([
    'call_volume',
    'outcome_summary',
    'language_distribution',
    'compliance_status',
    'usage_summary',
  ]),
  from_date: z.string(),
  to_date: z.string(),
  group_by: z.enum(['day', 'week', 'month']).optional(),
});

/**
 * Tool 9: Access Audit Log
 * Retrieves hash-linked audit events
 */
export const accessAuditLogSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  event_type: z.string().optional(),
  actor_type: z.enum(['system', 'user', 'agent', 'provider']).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  verify_chain: z.boolean().default(false),
});

/**
 * Tool 10: Create Dev Token
 * Creates a development bearer token for a tenant
 */
export const createDevTokenSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(128),
  scopes: z.array(z.enum(['simulate', 'read', 'write', 'admin'])).default(['simulate', 'read']),
  expires_in_days: z.number().int().min(1).max(365).default(30),
});

/**
 * Tool 11: Validate Compliance
 * Validates specific compliance evidence for a call intent
 */
export const validateComplianceSchema = z.object({
  tenant_id: z.string().uuid(),
  call_intent_id: z.string().uuid(),
  evidence: z.object({
    business_license_verified: z.boolean(),
    dncr_checked: z.boolean(),
    consent_obtained: z.boolean(),
    ai_disclosure_planned: z.boolean(),
    calling_hours_compliant: z.boolean(),
    recording_consent: z.boolean().optional(),
  }),
});

export const TOOL_SCHEMAS = {
  onboard_tenant: onboardTenantSchema,
  configure_business: configureBusinessSchema,
  simulate_call: simulateCallSchema,
  simulate_conversation: simulateConversationSchema,
  check_readiness: checkReadinessSchema,
  get_call_status: getCallStatusSchema,
  list_call_history: listCallHistorySchema,
  generate_report: generateReportSchema,
  access_audit_log: accessAuditLogSchema,
  create_dev_token: createDevTokenSchema,
  validate_compliance: validateComplianceSchema,
};

export async function registerTools(server, deps) {
  const { auditLogger, authMiddleware } = deps;
  const db = (await import('../store.mjs')).getDatabase();

  // Tool 1: Onboard Tenant
  server.tool(
    'onboard_tenant',
    'Create a new tenant with business configuration',
    onboardTenantSchema.shape,
    async args => {
      const tenantId = crypto.randomUUID();

      db.prepare(
        `
        INSERT INTO tenants (id, name, domain, settings, compliance_status)
        VALUES (?, ?, ?, ?, 'pending')
      `,
      ).run(tenantId, args.name, args.domain || null, JSON.stringify({}));

      if (args.admin_email) {
        const userId = crypto.randomUUID();
        db.prepare(
          'INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)',
        ).run(userId, tenantId, args.admin_email, args.admin_name || 'Admin', 'admin');
      }

      // Create business config if sector provided
      if (args.sector) {
        const configId = crypto.randomUUID();
        db.prepare(
          `
          INSERT INTO business_configs (id, tenant_id, sector, business_name, license_number, license_expiry, supported_languages, calling_hours)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          configId,
          tenantId,
          args.sector,
          args.business_name || null,
          args.license_number || null,
          args.license_expiry || null,
          JSON.stringify(args.supported_languages),
          JSON.stringify(
            args.calling_hours || { start: '09:00', end: '21:00', timezone: 'Asia/Dubai' },
          ),
        );
      }

      await auditLogger.log({
        tenant_id: tenantId,
        event_type: 'tenant_onboarded',
        actor_type: 'system',
        action: 'onboard_tenant',
        resource_type: 'tenant',
        resource_id: tenantId,
        payload: { name: args.name, domain: args.domain, sector: args.sector },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ tenant_id: tenantId, status: 'onboarded' }, null, 2),
          },
        ],
      };
    },
  );

  // Tool 2: Configure Business
  server.tool(
    'configure_business',
    'Update business configuration for a tenant',
    configureBusinessSchema.shape,
    async args => {
      const { tenant_id, ...updates } = args;

      const existing = db
        .prepare('SELECT * FROM business_configs WHERE tenant_id = ?')
        .get(tenant_id);

      if (existing) {
        const setClause = [];
        const params = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            setClause.push(`${key} = ?`);
            params.push(typeof value === 'object' ? JSON.stringify(value) : value);
          }
        }

        if (setClause.length > 0) {
          setClause.push('updated_at = datetime("now")');
          params.push(tenant_id);
          db.prepare(`UPDATE business_configs SET ${setClause.join(', ')} WHERE tenant_id = ?`).run(
            ...params,
          );
        }
      } else {
        const configId = crypto.randomUUID();
        db.prepare(
          `
          INSERT INTO business_configs (id, tenant_id, sector, business_name, license_number, license_expiry, supported_languages, calling_hours, max_retries, retry_cooldown_hours, ai_disclosure_enabled, recording_consent_required, dncr_check_enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          configId,
          tenant_id,
          updates.sector || null,
          updates.business_name || null,
          updates.license_number || null,
          updates.license_expiry || null,
          JSON.stringify(updates.supported_languages || ['en']),
          JSON.stringify(
            updates.calling_hours || { start: '09:00', end: '21:00', timezone: 'Asia/Dubai' },
          ),
          updates.max_retries || 3,
          updates.retry_cooldown_hours || 24,
          updates.ai_disclosure_enabled !== false ? 1 : 0,
          updates.recording_consent_required !== false ? 1 : 0,
          updates.dncr_check_enabled !== false ? 1 : 0,
        );
      }

      await auditLogger.log({
        tenant_id,
        event_type: 'business_configured',
        actor_type: 'system',
        action: 'configure_business',
        resource_type: 'business_config',
        resource_id: tenant_id,
        payload: updates,
      });

      return {
        content: [
          { type: 'text', text: JSON.stringify({ tenant_id, status: 'configured' }, null, 2) },
        ],
      };
    },
  );

  // Tool 3: Simulate Call
  server.tool(
    'simulate_call',
    'Create an idempotent simulated call intent (v0.2 simulation mode)',
    simulateCallSchema.shape,
    async args => {
      const parsed = simulateCallSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'Missing required fields', details: parsed.error.flatten() },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const {
        tenant_id,
        idempotency_key,
        direction,
        from_number,
        to_number,
        language,
        voice_config,
        business_context,
      } = parsed.data;

      // Check idempotency
      const existing = db
        .prepare('SELECT * FROM call_intents WHERE tenant_id = ? AND idempotency_key = ?')
        .get(tenant_id, idempotency_key);
      if (existing) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  call_intent_id: existing.id,
                  status: existing.status,
                  idempotent: true,
                  message: 'Call intent already exists (idempotent)',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const callIntentId = crypto.randomUUID();

      db.prepare(
        `
        INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, from_number, to_number, language, voice_config, business_context, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `,
      ).run(
        callIntentId,
        tenant_id,
        idempotency_key,
        direction,
        from_number || null,
        to_number || null,
        language,
        JSON.stringify(voice_config || {}),
        JSON.stringify(business_context || {}),
      );

      // Log initial event
      const eventId = crypto.randomUUID();
      const prevHash = '0'.repeat(64); // Simplified for v0.2
      const eventHash = await hashEventAsync({ eventId, callIntentId, type: 'created', prevHash });

      db.prepare(
        `
        INSERT INTO call_events (id, call_intent_id, event_type, payload, sequence_number, previous_event_hash, event_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        eventId,
        callIntentId,
        'call_intent_created',
        JSON.stringify({ direction, language }),
        0,
        prevHash,
        eventHash,
      );

      await auditLogger.log({
        tenant_id,
        event_type: 'call_intent_created',
        actor_type: 'system',
        action: 'simulate_call',
        resource_type: 'call_intent',
        resource_id: callIntentId,
        payload: { direction, language, idempotency_key },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                call_intent_id: callIntentId,
                status: 'pending',
                idempotent: false,
                message: 'Call intent created (simulation mode - live calls disabled)',
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 4: Simulate Conversation
  server.tool(
    'simulate_conversation',
    'Get deterministic conversation fixture for testing',
    simulateConversationSchema.shape,
    async args => {
      const { language, scenario } = args;
      const fixture = db
        .prepare('SELECT * FROM conversation_fixtures WHERE language = ? AND scenario = ?')
        .get(language, scenario);

      if (!fixture) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: `No fixture found for ${language}/${scenario}` },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                language: fixture.language,
                scenario: fixture.scenario,
                turns: JSON.parse(fixture.turns),
                expected_outcome: fixture.expected_outcome,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 5: Check Readiness
  server.tool(
    'check_readiness',
    'Validate tenant compliance and configuration readiness',
    checkReadinessSchema.shape,
    async args => {
      const { tenant_id } = args;

      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
      if (!tenant) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Tenant not found' }, null, 2) }],
          isError: true,
        };
      }

      const config = db
        .prepare('SELECT * FROM business_configs WHERE tenant_id = ?')
        .get(tenant_id);
      const apiKeys = db.prepare('SELECT * FROM api_keys WHERE tenant_id = ?').all(tenant_id);

      const checks = {
        tenant_exists: true,
        business_configured: !!config,
        license_valid: config
          ? !config.license_expiry || new Date(config.license_expiry) > new Date()
          : false,
        api_keys_exist: apiKeys.length > 0,
        supported_languages: config ? JSON.parse(config.supported_languages || '["en"]') : ['en'],
        calling_hours_set: !!config,
        ai_disclosure_enabled: config ? Boolean(config.ai_disclosure_enabled) : false,
        recording_consent_required: config ? Boolean(config.recording_consent_required) : false,
        dncr_check_enabled: config ? Boolean(config.dncr_check_enabled) : false,
        live_calls_disabled: true, // v0.2 guarantee
      };

      const ready = checks.business_configured && checks.license_valid && checks.api_keys_exist;

      await auditLogger.log({
        tenant_id,
        event_type: 'readiness_checked',
        actor_type: 'system',
        action: 'check_readiness',
        payload: { ready, checks },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify({ ready, checks }, null, 2) }],
      };
    },
  );

  // Tool 6: Get Call Status
  server.tool(
    'get_call_status',
    'Get call intent status and event history',
    getCallStatusSchema.shape,
    async args => {
      const { tenant_id, call_intent_id } = args;

      const intent = db
        .prepare('SELECT * FROM call_intents WHERE id = ? AND tenant_id = ?')
        .get(call_intent_id, tenant_id);
      if (!intent) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Call intent not found' }, null, 2) },
          ],
          isError: true,
        };
      }

      const events = db
        .prepare('SELECT * FROM call_events WHERE call_intent_id = ? ORDER BY sequence_number')
        .all(call_intent_id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                call_intent: {
                  id: intent.id,
                  tenant_id: intent.tenant_id,
                  direction: intent.direction,
                  from_number: intent.from_number,
                  to_number: intent.to_number,
                  status: intent.status,
                  language: intent.language,
                  created_at: intent.created_at,
                  dispatched_at: intent.dispatched_at,
                  completed_at: intent.completed_at,
                },
                events: events.map(e => ({
                  id: e.id,
                  event_type: e.event_type,
                  payload: JSON.parse(e.payload),
                  provider_event_id: e.provider_event_id,
                  provider_name: e.provider_name,
                  sequence_number: e.sequence_number,
                  created_at: e.created_at,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 7: List Call History
  server.tool(
    'list_call_history',
    'List paginated call history for a tenant',
    listCallHistorySchema.shape,
    async args => {
      const parsed = listCallHistorySchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'Invalid arguments', details: parsed.error.flatten() },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      const { tenant_id, status, direction, from_date, to_date, limit, offset } = parsed.data;

      let where = 'tenant_id = ?';
      const params = [tenant_id];

      if (status) {
        where += ' AND status = ?';
        params.push(status);
      }
      if (direction) {
        where += ' AND direction = ?';
        params.push(direction);
      }
      if (from_date) {
        where += ' AND created_at >= ?';
        params.push(from_date);
      }
      if (to_date) {
        where += ' AND created_at <= ?';
        params.push(to_date);
      }

      const intents = db
        .prepare(
          `
        SELECT * FROM call_intents
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(...params, limit, offset);

      const total = db
        .prepare(`SELECT COUNT(*) as count FROM call_intents WHERE ${where}`)
        .get(...params).count;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                calls: intents.map(i => ({
                  id: i.id,
                  direction: i.direction,
                  from_number: i.from_number,
                  to_number: i.to_number,
                  status: i.status,
                  language: i.language,
                  created_at: i.created_at,
                  completed_at: i.completed_at,
                })),
                pagination: { total, limit, offset },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 8: Generate Report
  server.tool(
    'generate_report',
    'Generate analytics report for a tenant',
    generateReportSchema.shape,
    async args => {
      const { tenant_id, report_type, from_date, to_date } = args;

      // Simplified report generation for v0.2
      const baseQuery = `
        SELECT * FROM call_intents
        WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
      `;

      const intents = db.prepare(baseQuery).all(tenant_id, from_date, to_date);

      let report = {};

      switch (report_type) {
        case 'call_volume':
          report = {
            total_calls: intents.length,
            by_status: intents.reduce((acc, i) => {
              acc[i.status] = (acc[i.status] || 0) + 1;
              return acc;
            }, {}),
            by_direction: intents.reduce((acc, i) => {
              acc[i.direction] = (acc[i.direction] || 0) + 1;
              return acc;
            }, {}),
            by_language: intents.reduce((acc, i) => {
              acc[i.language] = (acc[i.language] || 0) + 1;
              return acc;
            }, {}),
          };
          break;
        case 'outcome_summary':
          report = {
            completed: intents.filter(i => i.status === 'completed').length,
            failed: intents.filter(i => i.status === 'failed').length,
            cancelled: intents.filter(i => i.status === 'cancelled').length,
            pending: intents.filter(i => i.status === 'pending').length,
          };
          break;
        case 'language_distribution':
          report = {
            ar: intents.filter(i => i.language === 'ar').length,
            en: intents.filter(i => i.language === 'en').length,
          };
          break;
        case 'compliance_status':
          report = {
            total_intents: intents.length,
            with_approval: intents.filter(i => i.approval_id).length,
            simulated_only: intents.length, // v0.2
          };
          break;
        case 'usage_summary':
          report = {
            period: { from: from_date, to: to_date },
            total_calls: intents.length,
            unique_callers: new Set(intents.map(i => i.from_number).filter(Boolean)).size,
            avg_duration_estimate: 0, // v0.2 simulation
          };
          break;
      }

      await auditLogger.log({
        tenant_id,
        event_type: 'report_generated',
        actor_type: 'system',
        action: 'generate_report',
        payload: { report_type, from_date, to_date },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { report_type, tenant_id, period: { from: from_date, to: to_date }, data: report },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 9: Access Audit Log
  server.tool(
    'access_audit_log',
    'Retrieve hash-linked audit events',
    accessAuditLogSchema.shape,
    async args => {
      const { tenant_id, event_type, actor_type, from_date, to_date, limit, offset, verify_chain } =
        args;

      const events = await auditLogger.getEvents({
        tenant_id,
        event_type,
        actor_type,
        from_date,
        to_date,
        limit,
        offset,
      });

      let verification = null;
      if (verify_chain) {
        verification = await auditLogger.verifyChain();
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                events,
                verification,
                pagination: { limit, offset },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 10: Create Dev Token
  server.tool(
    'create_dev_token',
    'Create a development bearer token for a tenant (v0.2 only)',
    createDevTokenSchema.shape,
    async args => {
      const { tenant_id, name, scopes, expires_in_days } = args;

      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
      if (!tenant) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Tenant not found' }, null, 2) }],
          isError: true,
        };
      }

      const tokenResult = await authMiddleware.createDevToken(
        tenant_id,
        name,
        scopes,
        expires_in_days,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                token: tokenResult.token,
                key_id: tokenResult.keyId,
                expires_at: tokenResult.expiresAt,
                scopes: tokenResult.scopes,
                warning: 'Development token - never use in production',
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool 11: Validate Compliance
  server.tool(
    'validate_compliance',
    'Validate compliance evidence for a call intent',
    validateComplianceSchema.shape,
    async args => {
      const { tenant_id, call_intent_id, evidence } = args;

      const intent = db
        .prepare('SELECT * FROM call_intents WHERE id = ? AND tenant_id = ?')
        .get(call_intent_id, tenant_id);
      if (!intent) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Call intent not found' }, null, 2) },
          ],
          isError: true,
        };
      }

      const config = db
        .prepare('SELECT * FROM business_configs WHERE tenant_id = ?')
        .get(tenant_id);

      const results = {
        business_license_verified: evidence.business_license_verified,
        dncr_checked: evidence.dncr_checked,
        consent_obtained: evidence.consent_obtained,
        ai_disclosure_planned: evidence.ai_disclosure_planned,
        calling_hours_compliant: evidence.calling_hours_compliant,
        recording_consent: evidence.recording_consent ?? config?.recording_consent_required,
        all_passed: true,
      };

      // Check all required evidence
      results.all_passed = Object.entries(results)
        .filter(([key]) => key !== 'all_passed')
        .every(([, value]) => value === true);

      // Update call intent with compliance evidence
      db.prepare(
        "UPDATE call_intents SET compliance_evidence = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(JSON.stringify(evidence), call_intent_id);

      await auditLogger.log({
        tenant_id,
        event_type: 'compliance_validated',
        actor_type: 'system',
        action: 'validate_compliance',
        resource_type: 'call_intent',
        resource_id: call_intent_id,
        payload: { evidence, results },
      });

      return {
        content: [
          { type: 'text', text: JSON.stringify({ call_intent_id, evidence, results }, null, 2) },
        ],
      };
    },
  );
}
