/**
 * CALLFORGE AI — Remote MCP endpoint (M09, simulation-first)
 *
 * POST /mcp (JSON-RPC 2.0, Streamable HTTP subsets): methods tools/list and
 * tools/call. Security contract:
 * - Authentication + scope enforcement via the server guard() (M02 OAuth).
 * - tenant_id is taken ONLY from the verified token context; any client-
 *   supplied tenant_id is stripped and a mismatch is rejected with 403.
 * - create_dev_token and other sensitive tools are excluded from the remote
 *   registry, even though they exist for the stdio transport.
 * - Every tool declaration advertises explicit annotations (conservative
 *   defaults) and a tenant_id-free input schema.
 * - No external side effects yet: all tools remain the simulation baseline
 *   until SEC-001 is resolved. Simulation-first means call creation here is
 *   the same simulated path as /simulate/* — no live calls ever.
 */
import { TOOL_SCHEMAS } from './tools/index.mjs';

const REMOTE_EXCLUDED = new Set([
  'create_dev_token', // sensitive: must never be reachable remotely
]);

const REMOTE_TOOLS = Object.keys(TOOL_SCHEMAS).filter(name => !REMOTE_EXCLUDED.has(name));

const TOOL_SCOPES = {
  onboard_tenant: ['admin'],
  configure_business: ['admin'],
  simulate_call: ['simulate'],
  simulate_conversation: ['simulate'],
  check_readiness: ['read'],
  get_call_status: ['read'],
  list_call_history: ['read'],
  generate_report: ['read'],
  access_audit_log: ['audit'],
  validate_compliance: ['read'],
};

function publicSchema(name) {
  const schema = TOOL_SCHEMAS[name];
  const shape = schema.shape ?? schema._def.shape();
  const properties = {};
  for (const [key, value] of Object.entries(shape)) {
    if (key === 'tenant_id') {
      continue; // tenant context comes from the token, never the client
    }
    properties[key] = value;
  }
  return { type: 'object', properties, additionalProperties: false };
}

export function listRemoteTools() {
  return REMOTE_TOOLS.map(name => ({
    name,
    description: `Simulation-baseline remote tool: ${name}`,
    inputSchema: publicSchema(name),
    annotations: {
      title: name.replace(/_/g, ' '),
      readOnlyHint: !(TOOL_SCOPES[name] ?? []).includes('simulate'),
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

export function remoteToolScopes(name) {
  return TOOL_SCOPES[name] ?? null;
}

/**
 * Validate and adapt client args to the stdio tool handler contract:
 * tenant_id is injected from the token context; a mismatched client-supplied
 * tenant_id is rejected (caller should surface 403).
 */
export function adaptRemoteArgs(name, rawArgs, context) {
  if (!REMOTE_TOOLS.includes(name)) {
    return { error: 'unknown_tool', message: `Tool not available remotely: ${name}` };
  }
  const args = { ...(rawArgs ?? {}) };
  if (args.tenant_id && args.tenant_id !== context.tenantId) {
    return { error: 'tenant_mismatch', message: 'tenant_id does not match token tenant' };
  }
  delete args.tenant_id;
  if (TOOL_SCHEMAS[name].shape?.tenant_id) {
    return { args: { ...args, tenant_id: context.tenantId }, tenantInjected: true };
  }
  return { args, tenantInjected: false };
}

export function createMcpHandler({ guard, callTool }) {
  async function handle(req, res) {
    const chunks = [];
    let length = 0;
    const maxBytes = Number(process.env.MCP_MAX_BODY_BYTES || 1048576);
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32013, message: 'payload too large' },
            id: null,
          }),
        );
        return;
      }
      chunks.push(chunk);
    }
    let envelope;
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'parse error' },
          id: null,
        }),
      );
      return;
    }
    const context = guard(req, res, []);
    if (!context) {
      return; // guard already responded
    }
    const { method, params = {}, id = null } = envelope;
    if (method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result: { tools: listRemoteTools() }, id }));
      return;
    }
    if (method === 'tools/call') {
      const name = params.name;
      const scopes = remoteToolScopes(name);
      if (!scopes) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'method not found' },
            id,
          }),
        );
        return;
      }
      const check = guard(req, res, scopes) ?? null;
      if (!check) {
        return;
      }
      const adapted = adaptRemoteArgs(name, params.arguments, context);
      if (adapted.error) {
        const status = adapted.error === 'tenant_mismatch' ? 403 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: adapted.message }, id }),
        );
        return;
      }
      const result = await callTool(name, adapted.args, context);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'method not found' }, id }),
    );
  }
  return { handle };
}
