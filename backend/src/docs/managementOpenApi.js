const queryParameters = [
  { name: "period", in: "query", schema: { type: "string", pattern: "^\\d{4}(-\\d{2})?$" }, description: "Accounting year (YYYY) or month (YYYY-MM)." },
  { name: "dateFrom", in: "query", schema: { type: "string", format: "date" }, description: "Request issue date lower bound." },
  { name: "dateTo", in: "query", schema: { type: "string", format: "date" }, description: "Request issue date upper bound, inclusive." },
  { name: "area", in: "query", schema: { type: "string", maxLength: 120 }, description: "Exact organizational area returned by the filters endpoint." }
];

const aggregateResponse = {
  description: "Aggregate management snapshot.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["apiVersion", "asOf", "currency", "appliedFilters", "data"],
        properties: {
          apiVersion: { type: "string", example: "1.0" },
          asOf: { type: "string", format: "date-time" },
          currency: { type: "string", enum: ["PEN"] },
          freshnessSeconds: { type: "integer", minimum: 0 },
          appliedFilters: { type: "object", additionalProperties: { type: "string" } },
          data: { type: "object", additionalProperties: true }
        }
      }
    }
  }
};

function aggregatePath(summary) {
  return {
    get: {
      summary,
      security: [{ bearerAuth: [] }],
      parameters: queryParameters,
      responses: {
        200: aggregateResponse,
        401: { description: "Missing, invalid, or expired token." },
        403: { description: "The account does not have management-portal:view." },
        422: { description: "Invalid filter." },
        429: { description: "Rate limit exceeded." }
      }
    }
  };
}

export const managementOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "UMA Management API",
    version: "1.0.0",
    description: "Read-only, authenticated institutional aggregates for the UMA Management Portal. Responses intentionally exclude request, supplier, employee, invoice, bank-account, file, and audit-actor identifiers."
  },
  servers: [{ url: "/api", description: "Same origin as the UMA portal" }],
  tags: [{ name: "Authentication" }, { name: "Management" }],
  paths: {
    "/auth/login": {
      post: {
        tags: ["Authentication"],
        summary: "Create an authenticated session token",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } } } } } },
        responses: { 200: { description: "JWT and current user." }, 401: { description: "Invalid credentials." }, 429: { description: "Too many failed attempts." } }
      }
    },
    "/management/v1/overview": aggregatePath("Executive KPI overview"),
    "/management/v1/budget": aggregatePath("Aggregate budget position"),
    "/management/v1/workflow": aggregatePath("Workflow volumes by status, flow, period, and area"),
    "/management/v1/payments": aggregatePath("Payment, schedule, ageing, and reconciliation aggregates"),
    "/management/v1/sla": aggregatePath("Approval SLA aggregates"),
    "/management/v1/filters": {
      get: {
        tags: ["Management"],
        summary: "Available periods and areas",
        security: [{ bearerAuth: [] }],
        responses: { 200: aggregateResponse, 401: { description: "Missing, invalid, or expired token." }, 403: { description: "Insufficient permission." } }
      }
    },
    "/management/v1/openapi.json": {
      get: { tags: ["Management"], summary: "OpenAPI document", responses: { 200: { description: "OpenAPI 3.1 document." } } }
    }
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }
  }
};
