# UMA Management API v1

## External gateway already deployed

The separate public gateway is deployed at:

- Viewer portal: `https://uma-management-read-api.onrender.com/`
- Gateway health: `https://uma-management-read-api.onrender.com/health`
- Full readiness: `https://uma-management-read-api.onrender.com/ready`
- Gateway OpenAPI: `https://uma-management-read-api.onrender.com/openapi.yaml`

External consumers authenticate to that gateway with either:

```http
X-API-Key: YOUR_VIEWER_KEY
```

or:

```http
Authorization: Bearer YOUR_VIEWER_KEY
```

Its read-only endpoints are:

```text
GET /api/v1/management/dashboard
GET /api/v1/management/report
GET /api/v1/management/filters
GET /api/v1/management/snapshot
```

Use `GET /api/v1/management/snapshot?period=YYYY-MM` when another application needs one combined payload. The gateway accepts only `GET`, `HEAD`, and `OPTIONS`; it does not expose approvals, edits, accounting, Treasury, payment, reconciliation, supplier, user, or configuration actions.

At the time this documentation was finalized, the gateway itself was deployed but `/ready` reported that `FINANCE_API_BASE_URL` could not resolve the UMA Finance backend. Deploy this repository's Finance web service with a cloud MongoDB connection, then set the gateway's `FINANCE_API_BASE_URL` to that service URL. Do not configure it as `localhost`.

The rest of this document describes the direct versioned API now included in the UMA Finance backend. It is the authoritative aggregate source used by the built-in `/management-view` portal and can also be used by trusted clients with a `ManagementViewer` account.

Version: **1.0.0**

Base URL: `https://YOUR-SERVICE.onrender.com/api`

Portal: `https://YOUR-SERVICE.onrender.com/management-view`

OpenAPI: `https://YOUR-SERVICE.onrender.com/api/management/v1/openapi.json`

Quick reference: `https://YOUR-SERVICE.onrender.com/api-docs/management`

## Purpose and access boundary

The Management API provides current, read-only financial and workflow aggregates. It is intended for a person who needs the Management Portal but must not enter UMA's operational screens.

Create that person in **Administration → Users & Roles** with role `ManagementViewer`. This role has one permission: `management-portal:view`. It cannot use Requests, Approvals, Budget Control, Accounting, Treasury, SIRE, Administration, file downloads, or any write endpoint. Existing `Management` and `Admin` accounts may also use this API.

Responses exclude request references and descriptions, supplier names and RUCs, employee names and identifiers, vouchers, CXP references, bank accounts and CCI, document links, file hashes, comments, and audit actors.

## Authentication

Send credentials to `POST /api/auth/login`:

```json
{
  "email": "viewer@example.org",
  "password": "assigned-password"
}
```

Use the returned JWT on every management request:

```http
Authorization: Bearer eyJ...
Accept: application/json
```

Tokens expire according to `JWT_EXPIRES_IN` (8 hours in the Render blueprint). Do not put tokens in URLs or shared API documents. Create an individual account for every external viewer so access can be deactivated independently.

## Common filters and response envelope

All data endpoints accept these optional query parameters:

| Parameter | Format | Meaning |
|---|---|---|
| `period` | `YYYY` or `YYYY-MM` | Accounting year or month |
| `dateFrom` | `YYYY-MM-DD` | Request issue date lower bound |
| `dateTo` | `YYYY-MM-DD` | Request issue date upper bound, inclusive |
| `area` | Exact area string | Organizational area returned by `/filters` |

Date filters apply to request-derived workflow, payment, and SLA measures. Budget totals use `period` and `area` because budget plans are period-based rather than request-date-based.

Successful responses use this envelope:

```json
{
  "apiVersion": "1.0",
  "asOf": "2026-09-18T15:30:00.000Z",
  "currency": "PEN",
  "appliedFilters": {
    "period": "2026-09",
    "area": "",
    "dateFrom": "",
    "dateTo": ""
  },
  "freshnessSeconds": 0,
  "data": {}
}
```

The API caches aggregate snapshots for 15 seconds by default. `asOf` states when the snapshot was calculated, and `freshnessSeconds` states its current age.

## Endpoints

### `GET /api/management/v1/overview`

Returns `pendingRequests`, `pendingApprovals`, `observedRequests`, `overdueApprovals`, `pendingPayments`, `pendingPaymentAmountPEN`, `paidThisMonth`, `closedRequests`, and aggregate `budget`.

### `GET /api/management/v1/budget`

Returns `totals.assignedPEN`, `committedPEN`, `executedPEN`, `paidPEN`, `availablePEN`, `utilizationPercent`, `allocationCount`, `lowBalanceCount`, and `overExecutedCount`.

### `GET /api/management/v1/workflow`

Returns arrays named `byStatus`, `byFlow`, `byPeriod`, `byArea`, and `rendition`. Each row uses this aggregate shape:

```json
{ "key": "PENDIENTE_APROBACION", "count": 7, "amountPEN": 98500 }
```

Historical `PAGADO_CERRADO` and `LIQUIDADO_CERRADO` records are reported under canonical `CERRADO`.

### `GET /api/management/v1/payments`

Returns aggregate `byStatus`, `nextSevenDays`, `paidByMonth`, `reconciliation`, and `ageing` arrays. `PAYMENT_FILE_CREATED` remains separate from `PAID`.

### `GET /api/management/v1/sla`

Returns completed SLA results, average approval hours by area, and current `ON_TRACK`, `OVERDUE`, and `LONG_OVERDUE` queues. The long-overdue threshold uses `SLA_ESCALATION_HOURS`.

### `GET /api/management/v1/filters`

Returns valid `periods` and `areas` for client controls. This endpoint takes no filters.

## Errors

| HTTP | Meaning |
|---|---|
| `401` | Token missing, invalid, expired, or account inactive |
| `403` | Account lacks `management-portal:view` |
| `404` | Endpoint does not exist |
| `422` | Filter format is invalid |
| `429` | Per-user request limit exceeded |
| `500` | Unexpected server failure; details are hidden in production |

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "period must use YYYY or YYYY-MM.",
  "details": { "field": "period" }
}
```

## JavaScript client example

```javascript
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password })
}).then((response) => response.json());

const overview = await fetch(`${baseUrl}/api/management/v1/overview?period=2026-09`, {
  headers: { Authorization: `Bearer ${login.token}` }
}).then((response) => response.json());
```

## Render deployment

The repository includes `render.yaml`. Create a Render Blueprint from the GitHub repository, then provide:

1. `MONGODB_URI`: a MongoDB Atlas connection string restricted to the UMA database user.
2. `CLIENT_URLS`: the final service origin, such as `https://uma-finance.onrender.com`.
3. The same `MONGODB_URI` for the SLA worker.

The web service builds the frontend and serves the SPA and API from one origin. A persistent disk is mounted at `/var/data` for uploads, generated evidence, and the local SUNAT Padrón. The SLA worker runs separately. MongoDB Atlas must accept Render connections and should have a tested backup before production migration.

After deployment:

1. Open `/health` and confirm `managementApi` is `v1`.
2. Sign in as Admin and create a `ManagementViewer` user.
3. Test `/management-view` in a private browser session.
4. Confirm internal UI routes and internal APIs return access denied for that viewer.
5. Replace or deactivate the test account after verification.

The batch invoice worker is intentionally absent from this Blueprint because Render persistent disks cannot be shared between services and the current worker reads uploaded files from the web service filesystem. Use shared object storage before running that worker as a separate Render service. This limitation does not affect the Management Portal or API.
