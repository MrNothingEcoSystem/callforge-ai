/**
 * CALLFORGE AI — Tools Integration Tests
 * v0.2 Simulation Baseline
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initDatabase,
  getDatabase,
  closeStore,
  generateId,
  setTestDatabasePath,
} from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { registerTools } from '../tools/index.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

const TEST_DB_DIR = join(process.cwd(), 'data', 'test-tools');
const TEST_DB_PATH = join(TEST_DB_DIR, 'callforge.db');

// Mock MCP Server
class MockMcpServer {
  constructor() {
    this.tools = new Map();
  }

  tool(name, description, schema, handler) {
    this.tools.set(name, { name, description, schema, handler });
  }

  async callTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.handler(args);
  }
}

describe('MCP Tools Integration', () => {
  let server;
  let auditLogger;
  let authMiddleware;
  let tenantId;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    await initDatabase();
    auditLogger = createAuditLogger();
    await auditLogger.initialize();
    authMiddleware = createAuthMiddleware();
    server = new MockMcpServer();
    await registerTools(server, { auditLogger, authMiddleware });
  });

  afterAll(async () => {
    await closeStore();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM audit_events').run();
    db.prepare('DELETE FROM call_events').run();
    db.prepare('DELETE FROM call_intents').run();
    db.prepare('DELETE FROM business_configs').run();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM tenants').run();

    tenantId = generateId();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );
  });

  describe('onboard_tenant', () => {
    it('should create new tenant with config', async () => {
      const result = await server.callTool('onboard_tenant', {
        name: 'New Clinic',
        domain: 'clinic.example.com',
        sector: 'clinic',
        business_name: 'Health Clinic',
        license_number: 'LIC-999',
        admin_email: 'admin@clinic.example.com',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.tenant_id).toBeDefined();
      expect(response.status).toBe('onboarded');

      const db = getDatabase();
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(response.tenant_id);
      expect(tenant).toBeDefined();
      expect(tenant.name).toBe('New Clinic');
    });
  });

  describe('configure_business', () => {
    it('should create business config for tenant', async () => {
      const result = await server.callTool('configure_business', {
        tenant_id: tenantId,
        sector: 'real_estate',
        business_name: 'Dubai Properties',
        license_number: 'RE-12345',
        supported_languages: ['en', 'ar'],
        calling_hours: { start: '08:00', end: '20:00', timezone: 'Asia/Dubai' },
        max_retries: 3,
        ai_disclosure_enabled: true,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.tenant_id).toBe(tenantId);
      expect(response.status).toBe('configured');

      const db = getDatabase();
      const config = db.prepare('SELECT * FROM business_configs WHERE tenant_id = ?').get(tenantId);
      expect(config).toBeDefined();
      expect(config.sector).toBe('real_estate');
      expect(config.business_name).toBe('Dubai Properties');
      expect(JSON.parse(config.supported_languages)).toEqual(['en', 'ar']);
    });
  });

  describe('simulate_call', () => {
    it('should create call intent with idempotency', async () => {
      const idempotencyKey = 'test-call-123';

      const result1 = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        direction: 'outbound',
        from_number: '+971501234567',
        to_number: '+97141234567',
        language: 'en',
      });

      const response1 = JSON.parse(result1.content[0].text);
      expect(response1.call_intent_id).toBeDefined();
      expect(response1.status).toBe('pending');
      expect(response1.idempotent).toBe(false);

      // Second call with same idempotency key
      const result2 = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        direction: 'inbound',
        language: 'ar',
      });

      const response2 = JSON.parse(result2.content[0].text);
      expect(response2.call_intent_id).toBe(response1.call_intent_id);
      expect(response2.idempotent).toBe(true);
      expect(response2.message).toContain('idempotent');
    });

    it('should require required fields', async () => {
      const result = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        // missing idempotency_key and direction
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toContain('Missing required fields');
    });
  });

  describe('simulate_conversation', () => {
    it('should return English appointment booking fixture', async () => {
      const result = await server.callTool('simulate_conversation', {
        language: 'en',
        scenario: 'appointment_booking',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.language).toBe('en');
      expect(response.scenario).toBe('appointment_booking');
      expect(response.turns).toBeDefined();
      expect(response.turns.length).toBeGreaterThan(0);
      expect(response.expected_outcome).toBe('appointment_booked');
    });

    it('should return Arabic appointment booking fixture', async () => {
      const result = await server.callTool('simulate_conversation', {
        language: 'ar',
        scenario: 'appointment_booking',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.language).toBe('ar');
      expect(response.scenario).toBe('appointment_booking');
      expect(response.turns).toBeDefined();
      expect(response.turns.length).toBeGreaterThan(0);
      expect(response.turns[0].text).toContain('مرحباً');
    });

    it('should return 404 for unknown scenario', async () => {
      const result = await server.callTool('simulate_conversation', {
        language: 'en',
        scenario: 'unknown_scenario',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text);
      expect(error.error).toContain('No fixture found');
    });
  });

  describe('check_readiness', () => {
    it('should return not ready for unconfigured tenant', async () => {
      const result = await server.callTool('check_readiness', { tenant_id: tenantId });
      const response = JSON.parse(result.content[0].text);

      expect(response.ready).toBe(false);
      expect(response.checks.business_configured).toBe(false);
      expect(response.checks.live_calls_disabled).toBe(true);
    });

    it('should return ready for fully configured tenant', async () => {
      // Configure business
      await server.callTool('configure_business', {
        tenant_id: tenantId,
        sector: 'clinic',
        business_name: 'Test Clinic',
        license_number: 'LIC-123',
        license_expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        supported_languages: ['en'],
        calling_hours: { start: '09:00', end: '18:00', timezone: 'Asia/Dubai' },
      });

      // Create API key
      await authMiddleware.createDevToken(tenantId, 'Test Key', ['simulate', 'read'], 30);

      const result = await server.callTool('check_readiness', { tenant_id: tenantId });
      const response = JSON.parse(result.content[0].text);

      expect(response.ready).toBe(true);
      expect(response.checks.business_configured).toBe(true);
      expect(response.checks.license_valid).toBe(true);
      expect(response.checks.api_keys_exist).toBe(true);
    });
  });

  describe('get_call_status', () => {
    it('should return call intent with events', async () => {
      // Create call intent
      const simulateResult = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: 'status-test-1',
        direction: 'outbound',
        language: 'en',
      });
      const { call_intent_id } = JSON.parse(simulateResult.content[0].text);

      const result = await server.callTool('get_call_status', {
        tenant_id: tenantId,
        call_intent_id,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.call_intent.id).toBe(call_intent_id);
      expect(response.call_intent.status).toBe('pending');
      expect(response.events).toHaveLength(1);
      expect(response.events[0].event_type).toBe('call_intent_created');
    });

    it('should return 404 for non-existent call intent', async () => {
      const result = await server.callTool('get_call_status', {
        tenant_id: tenantId,
        call_intent_id: generateId(),
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('list_call_history', () => {
    it('should return paginated call history', async () => {
      // Create multiple call intents
      for (let i = 0; i < 5; i++) {
        await server.callTool('simulate_call', {
          tenant_id: tenantId,
          idempotency_key: `history-test-${i}`,
          direction: i % 2 === 0 ? 'outbound' : 'inbound',
          language: 'en',
        });
      }

      const result = await server.callTool('list_call_history', {
        tenant_id: tenantId,
        limit: 2,
        offset: 0,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.calls).toHaveLength(2);
      expect(response.pagination.total).toBe(5);
      expect(response.pagination.limit).toBe(2);
      expect(response.pagination.offset).toBe(0);
    });

    it('should filter by status', async () => {
      const simulateResult = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: 'filter-test',
        direction: 'outbound',
        language: 'en',
      });
      const { call_intent_id } = JSON.parse(simulateResult.content[0].text);

      // Manually update status to completed
      const db = getDatabase();
      db.prepare('UPDATE call_intents SET status = ? WHERE id = ?').run(
        'completed',
        call_intent_id,
      );

      const result = await server.callTool('list_call_history', {
        tenant_id: tenantId,
        status: 'completed',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.calls).toHaveLength(1);
      expect(response.calls[0].status).toBe('completed');
    });
  });

  describe('generate_report', () => {
    it('should generate call volume report', async () => {
      // Create some call intents
      for (let i = 0; i < 3; i++) {
        await server.callTool('simulate_call', {
          tenant_id: tenantId,
          idempotency_key: `report-test-${i}`,
          direction: 'outbound',
          language: i % 2 === 0 ? 'en' : 'ar',
        });
      }

      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const toDate = new Date().toISOString();

      const result = await server.callTool('generate_report', {
        tenant_id: tenantId,
        report_type: 'call_volume',
        from_date: fromDate,
        to_date: toDate,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.report_type).toBe('call_volume');
      expect(response.data.total_calls).toBe(3);
      expect(response.data.by_direction.outbound).toBe(3);
      expect(response.data.by_language.en).toBe(2);
      expect(response.data.by_language.ar).toBe(1);
    });
  });

  describe('access_audit_log', () => {
    it('should retrieve audit events', async () => {
      // Trigger some audit events
      await server.callTool('onboard_tenant', {
        name: 'Audit Test Tenant',
        admin_email: 'audit@test.com',
      });

      const result = await server.callTool('access_audit_log', {
        limit: 10,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.events).toBeDefined();
      expect(response.events.length).toBeGreaterThan(0);
    });

    it('should verify chain when requested', async () => {
      const result = await server.callTool('access_audit_log', {
        limit: 5,
        verify_chain: true,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.verification).toBeDefined();
      expect(response.verification.valid).toBe(true);
    });
  });

  describe('create_dev_token', () => {
    it('should create development token', async () => {
      const result = await server.callTool('create_dev_token', {
        tenant_id: tenantId,
        name: 'Integration Test Token',
        scopes: ['simulate', 'read', 'write'],
        expires_in_days: 7,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.token).toMatch(/^cf_dev_[a-f0-9]+$/);
      expect(response.key_id).toBeDefined();
      expect(response.scopes).toEqual(['simulate', 'read', 'write']);
      expect(response.warning).toContain('Development token');
    });
  });

  describe('validate_compliance', () => {
    it('should validate compliance evidence', async () => {
      // Create call intent first
      const simulateResult = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: 'compliance-test',
        direction: 'outbound',
        language: 'en',
      });
      const { call_intent_id } = JSON.parse(simulateResult.content[0].text);

      const result = await server.callTool('validate_compliance', {
        tenant_id: tenantId,
        call_intent_id,
        evidence: {
          business_license_verified: true,
          dncr_checked: true,
          consent_obtained: true,
          ai_disclosure_planned: true,
          calling_hours_compliant: true,
          recording_consent: true,
        },
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.all_passed).toBe(true);
      expect(response.results.business_license_verified).toBe(true);
    });

    it('should fail when evidence missing', async () => {
      const simulateResult = await server.callTool('simulate_call', {
        tenant_id: tenantId,
        idempotency_key: 'compliance-fail-test',
        direction: 'outbound',
        language: 'en',
      });
      const { call_intent_id } = JSON.parse(simulateResult.content[0].text);

      const result = await server.callTool('validate_compliance', {
        tenant_id: tenantId,
        call_intent_id,
        evidence: {
          business_license_verified: true,
          dncr_checked: false, // Missing
          consent_obtained: true,
          ai_disclosure_planned: true,
          calling_hours_compliant: true,
        },
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.results.all_passed).toBe(false);
      expect(response.results.dncr_checked).toBe(false);
    });
  });
});
