/**
 * CALLFORGE AI — Core MCP Server Entry Point
 * v0.2 Simulation Baseline
 *
 * This module initializes the MCP server with all registered tools
 * for onboarding, configuration, simulation, readiness, call status,
 * reports, and audit access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initDatabase, closeStore } from './store.mjs';
import { registerTools } from './tools/index.mjs';
import { createAuthMiddleware } from './auth.mjs';
import { createAuditLogger } from './audit.mjs';

const SERVER_NAME = 'callforge';
const SERVER_VERSION = '0.2.0';

class CallforgeServer {
  constructor() {
    this.server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    this.auditLogger = null;
    this.authMiddleware = null;
  }

  async initialize() {
    // Initialize database
    await initDatabase();

    // Initialize audit logger (hash-linked events)
    this.auditLogger = createAuditLogger();

    // Initialize auth middleware (tenant-scoped bearer tokens)
    this.authMiddleware = createAuthMiddleware();

    // Register all MCP tools
    await registerTools(this.server, {
      auditLogger: this.auditLogger,
      authMiddleware: this.authMiddleware,
    });

    // Log server initialization
    await this.auditLogger.initialize();
    await this.auditLogger.log({
      event_type: 'server_initialized',
      actor_type: 'system',
      action: 'initialize_server',
      payload: { version: SERVER_VERSION },
    });
  }

  async start() {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.shutdown();
      process.exit(0);
    });
  }

  async shutdown() {
    await this.auditLogger.log({
      event_type: 'server_shutdown',
      actor_type: 'system',
      action: 'shutdown_server',
    });
    await closeStore();
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new CallforgeServer();
  await server.start();
}

export { CallforgeServer };
