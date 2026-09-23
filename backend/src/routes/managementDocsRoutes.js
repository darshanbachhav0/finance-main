import { Router } from "express";

const router = Router();

router.get("/api-docs/management", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UMA Management API v1</title></head>
<body><main><h1>UMA Management API v1</h1><p>Read-only institutional aggregates for authorized Management Viewer accounts.</p>
<h2>Authentication</h2><p>Send credentials to <code>POST /api/auth/login</code>, then send <code>Authorization: Bearer &lt;token&gt;</code> with API requests.</p>
<h2>Endpoints</h2><ul><li><code>GET /api/management/v1/overview</code></li><li><code>GET /api/management/v1/budget</code></li><li><code>GET /api/management/v1/workflow</code></li><li><code>GET /api/management/v1/payments</code></li><li><code>GET /api/management/v1/sla</code></li><li><code>GET /api/management/v1/filters</code></li></ul>
<p>Optional filters: <code>period</code>, <code>dateFrom</code>, <code>dateTo</code>, and <code>area</code>.</p>
<p><a href="/api/management/v1/openapi.json">Download the OpenAPI 3.1 document</a></p>
<p>The API does not expose transaction-level records, personal data, supplier identifiers, bank details, files, or write operations.</p></main></body></html>`);
});

export default router;
