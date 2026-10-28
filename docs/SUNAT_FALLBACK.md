# SUNAT taxpayer verification

The platform queries Consulta RUC first. Set `SUNAT_CONSULTA_RUC_PADRON_FALLBACK=true`
to use SUNAT's official Padrón Reducido when the website blocks access or is unavailable.
Successful website results, including inactive taxpayers and unknown RUCs, are never replaced.

Keep `SUNAT_PADRON_WORKER_ENABLED=true` to refresh the downloaded dataset. Bootstrap it with
`npm run sunat:padron:sync`. Expired or incomplete data cannot verify a supplier.
The UI identifies the actual source and dataset date. The fallback supplies legal name,
taxpayer status, domicile condition and fiscal address; representatives require manual entry.
Neither source verifies the existence or acceptance of an individual invoice.

The initial local refresh downloaded the official dataset dated 27 October 2026 with
18,488,320 records. Subsequent refreshes retain earlier generations until a complete replacement
and its search indexes have passed validation.
