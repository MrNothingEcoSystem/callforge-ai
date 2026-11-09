# MCP / ChatGPT Integration Brief

The current implementation exposes 11 local MCP tools over stdio for development and testing:

1. `onboard_tenant`
2. `configure_business`
3. `simulate_call`
4. `simulate_conversation`
5. `check_readiness`
6. `get_call_status`
7. `list_call_history`
8. `generate_report`
9. `access_audit_log`
10. `create_dev_token`
11. `validate_compliance`

This is not a production ChatGPT integration. M09 requires remote HTTPS MCP transport, OAuth resource authentication, server-derived tenant context, least-privilege exposure, confirmation semantics, staging evidence, metadata, and submission assets. Development bearer tokens must never be exposed publicly.
