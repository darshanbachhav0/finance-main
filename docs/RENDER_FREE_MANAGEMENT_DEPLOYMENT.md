# UMA Management Portal on Render Free

This deployment is intended for a live Finance demonstration and read-only Management access. It uses:

- one Render Free web service for the UMA frontend, backend, and direct Management API;
- MongoDB Atlas M0 for durable database records;
- the existing `uma-management-read-api` Render Free gateway for external viewer-key access.

It does not provide durable file storage or continuously running background workers. Do not use this free topology for real BBVA files, SIRE evidence, invoice attachments, SUNAT Padrón data, or unattended SLA monitoring.

## 1. Prepare MongoDB Atlas

1. Create a MongoDB Atlas project and an M0/shared free cluster.
2. Select AWS and the Oregon (`us-west-2`) region to match the Render service in `render.yaml`.
3. Create a database user with `readWrite` access only to the target database, recommended name `uma_finance_demo`.
4. In the future Render service, open **Connect → Outbound** and copy every displayed CIDR range into Atlas **Network Access**. During first setup only, `0.0.0.0/0` can be used temporarily with a strong unique database password, then replaced with Render's outbound ranges.
5. In Atlas, select **Connect → Drivers**, copy the `mongodb+srv://` URI, replace the password, and set the database name:

   ```text
   mongodb+srv://UMA_USER:URL_ENCODED_PASSWORD@CLUSTER/uma_finance_demo?retryWrites=true&w=majority
   ```

Keep the URI only in Render's secret environment settings. Never commit it or send it with the API documentation.

## 2. Copy the labelled local demonstration database

The presentation seed is deliberately restricted to local MongoDB, so transfer the already verified local demo database with MongoDB Database Tools. Run these commands on the UMA computer after installing `mongodump` and `mongorestore`:

```powershell
mongodump --uri="mongodb://localhost:27018/uma_finance_triple_track_fresh" --archive="uma-finance-demo.archive.gz" --gzip
mongorestore --uri="mongodb+srv://UMA_USER:PASSWORD@CLUSTER/uma_finance_demo?retryWrites=true&w=majority" --archive="uma-finance-demo.archive.gz" --gzip --nsFrom="uma_finance_triple_track_fresh.*" --nsTo="uma_finance_demo.*"
```

Use a terminal environment variable or the tool's password prompt where possible so the Atlas password does not remain in shell history. Delete the local archive securely after verification.

This copies MongoDB records only. The 145 labelled sample files remain local and should not be uploaded to Render Free because its filesystem is temporary. The Management aggregates and charts use the database records and continue to work.

## 3. Create the Finance web service

1. In Render, select **New → Blueprint**.
2. Connect `https://github.com/darshanbachhav0/finance-main`.
3. Select branch `codex/management-api-portal` and confirm the root `render.yaml`.
4. Confirm the service is `uma-finance`, region **Oregon**, plan **Free**.
5. Enter the two values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | The Atlas URI for `uma_finance_demo` |
   | `CLIENT_URLS` | Initially `https://uma-finance.onrender.com`; replace it if Render assigns a different hostname |

6. Keep the generated `JWT_SECRET` and `DRAFT_ENCRYPTION_KEY`. Back them up in UMA's password manager before changing or recreating the service.
7. Deploy. If the actual hostname differs from `CLIENT_URLS`, update that variable and redeploy.

The Blueprint deliberately configures:

```text
NODE_ENV=production
SUNAT_PROVIDER_MODE=MANUAL
BANK_FILE_MODE=DEMO
BATCH_INVOICE_INLINE_PROCESSING=false
```

These settings keep a free demonstration from presenting temporary filesystem output as operational financial evidence.

## 4. Verify the Finance service

Open these URLs after the first deploy:

```text
https://YOUR-FINANCE-SERVICE.onrender.com/health
https://YOUR-FINANCE-SERVICE.onrender.com/management-view
https://YOUR-FINANCE-SERVICE.onrender.com/api-docs/management
https://YOUR-FINANCE-SERVICE.onrender.com/api/management/v1/openapi.json
```

The health response should be successful and identify Management API `v1`. Sign in as Admin and create an individual external user with role `ManagementViewer`. In a private browser window, confirm that the user can open `/management-view` and receives access denied for Administration, Accounting, Treasury, Requests, and write APIs.

## 5. Connect the existing public gateway

Open the Render service `uma-management-read-api`, then **Environment**, and set:

| Variable | Value |
|---|---|
| `FINANCE_API_BASE_URL` | `https://YOUR-FINANCE-SERVICE.onrender.com` |
| `FINANCE_SERVICE_EMAIL` | Dedicated internal Finance account email |
| `FINANCE_SERVICE_PASSWORD` | Strong password for that account |
| `FINANCE_REQUIRED_ROLE` | `MANAGEMENT` |
| `VIEWER_API_KEYS` | One or more high-entropy external viewer keys |
| `ALLOWED_ORIGINS` | The origins allowed to call the gateway, or the existing portal origin |

The gateway's internal service account must have the existing `Management` role because it reads the internal Management report endpoints. External recipients receive only a viewer key; do not give them the Finance service account, Atlas URI, JWT secret, or Render access.

Saving the gateway variables starts a new deployment. Verify:

```text
https://uma-management-read-api.onrender.com/health
https://uma-management-read-api.onrender.com/ready
https://uma-management-read-api.onrender.com/openapi.yaml
```

`/ready` must report that the Finance backend is reachable. Then open `https://uma-management-read-api.onrender.com/`, enter a viewer key, and load the dashboard.

## 6. Share access

Send the recipient:

1. Portal: `https://uma-management-read-api.onrender.com/`
2. API documentation: `https://uma-management-read-api.onrender.com/openapi.yaml`
3. Their viewer key through a separate private channel.

For a named person who needs the built-in UMA portal instead, create a `ManagementViewer` account and send:

1. `https://YOUR-FINANCE-SERVICE.onrender.com/management-view`
2. Their individual email and temporary password through separate channels.

Deactivate either credential after the demonstration or when access is no longer required.

## 7. Free-plan operating limits

- A Free web service spins down after 15 minutes without inbound traffic. The first request after sleep can take about one minute.
- The filesystem is ephemeral. Files disappear on restart, redeploy, or spin-down.
- A Free web service cannot attach a persistent disk.
- Each Render workspace receives 750 Free instance hours per calendar month. Two continuously active free services can exhaust the shared allowance.
- Render can restart Free services at any time.
- The current SLA and batch-invoice workers are not running in this topology.

For a Finance meeting, open both the Finance service and gateway a few minutes before the presentation so they are awake. Do not use artificial keep-alive traffic to bypass the free-plan behavior.

## 8. Production upgrade path

Before real Finance operations:

1. move the Finance service to paid compute and attach durable storage or, preferably, move attachments and generated evidence to versioned object storage;
2. deploy the SLA worker with the same Atlas database and configured thresholds;
3. deploy the batch worker only after it can access the same durable uploaded files;
4. load and update the official SUNAT Padrón outside the web startup path;
5. set `BANK_FILE_MODE=PRODUCTION` only after BBVA certification and secure durable file storage;
6. configure backups, monitoring, alerting, secret rotation, and a tested restore procedure;
7. use a custom domain and review CORS origins and Atlas network access.

The free deployment is suitable for Management demonstrations and controlled read-only evaluation. It is not production-ready for operational financial processing.
