# UMA Finance – PDF-Based Code Update (26 October 2026)

## Important scope
This is a **partial, source-level migration** based on the seven-page PDF `rafael doc(2).pdf`, not a claim that the complete proposed production platform is finished. It contains complete replacement source files (not snippets) for the changes enumerated below. The existing database and other system modules are retained. No destructive database migration was executed.

## Implemented in this delivery

### Payment calendar (PDF page 5)
- Shared calendar now uses the 15th and the last *working* day of the month instead of the 15th/30th.
- Last working day excludes weekends and national holidays in the existing Lima business-day helper. The PDF does not define what to do if the **15th** itself is a non-working day, so it remains the literal 15th in this code (manual override remains available).
- Existing same-day advance handling remains unchanged.

### Bank-file approval (PDF pages 5–6)
- New generated bank batches notify **GAF**, not Accounting.
- GAF (or Admin) is the final verifier/rejector of a payment TXT. SHA-256 and existing separation-of-duties checks remain.
- Accounting no longer has the role permission to release these payment files; the navigation is adjusted.
- Existing historical verified batches are not retroactively rewritten.

### Job category and other CECO charges (PDF pages 1,3,7)
- User records now have `jobCategory` from Portal de Personas, editable in User Administration.
- Requesters may charge a *different* cost center / use Por Encargo only with category 3, 5 or 6. Admin retains administrative override. Existing own-cost-center requests are permitted.
- **Before activation**, populate real employees' jobCategory values; no categories are guessed.

### Digital acceptance acta, first iteration (PDF pages 3–4)
- `FinancialRequest.digitalActa` stores reception result (total/partial/nonconforming), received goods/services, milestone, issue date, SHA-256 document fingerprint, named signers and electronic sign-off evidence.
- New protected endpoints: `POST /api/requests/:id/acta/issue` and `POST /api/requests/:id/acta/sign`.
- Request detail includes an Acta Digital panel. Requester issues/signs as receiver; supervisor signs as responsible manager; a separate vice rector signs for amount above 5 UIT (5× S/ 5,500 per PDF).
- Existing organization hierarchy is used to assign a responsible signatory. UMA must confirm whether the direct supervisor equals the actual responsible **cost center** manager for each department. Document cannot be silently overwritten after issue.
- Nonconforming actas are recorded as observed. Partial/nonconforming settlements, downloadable acta PDFs and qualified certificate-based signatures are **not** implemented in this update.
- **IMPORTANT:** Accounting enforcement is opt-in via `UMA_REQUIRE_DIGITAL_ACTA=true` because turning it on before configuring signers could block existing unpaid requests. With it enabled, non-advance A1/A2/B provisions require a completed, *TOTAL* conforming acta.
- The manual also requires follow-up on advances (acta within 30 days and factura within 15 days); deadline notifications and enforcement are **not** included here.

### Strict PDF document requirements, first iteration (PDF pages 2–3)
- New opt-in setting `UMA_ENFORCE_PDF_DOCUMENT_RULES=true` overrides the previous simplified rules for:
    - A1 SUBMISSION: three quotations with three separate suppliers and uploaded quotation evidence.
    - B SUBMISSION: XML **and** invoice PDF (the old code allowed quote-only submissions).
    - A2 INVOICE_REGISTRATION: XML evidence per invoice.
- Rules are reflected through existing document-policy endpoints. The UI should be tested for each invoice upload path, including batch uploads and historical requests, before enabling in production.
- These rules do not yet cover every special-case upload described in the PDF (CAPEX business case, M, E, H, etc.).

## Switches and rollout
Set these values in `backend/.env` **after** confirming your data and testing on a non-production database:

```dotenv
UMA_ENFORCE_PDF_DOCUMENT_RULES=true
UMA_REQUIRE_DIGITAL_ACTA=true
```

Both default to **false**. You can enable the strict document mode first, seed / assign the manager hierarchy and job categories, then separately enable the Accounting acta gate.

## Still required for a complete PDF migration
1. Dedicated **contract and recurring supplies registry**: invoice within quota skips repeat approval but keeps acta, supply variance and expiry alerts.
2. **M mobility, E student refunds, H teaching honoraria** complete form paths, signatures, document rules, limits and taxes.
3. Beneficiary cost-center *Por Encargo* **approval/acknowledgement** rather than only read-and-comment notifications.
4. Full **SUNAT detracciones lotes** with generated SUNAT-specific TXT, GAF approval and deposit evidence.
5. **Bank-statement import, automated matching, Treasury reconciliation and Accounting signature**; current reconciliation is not the full PDF flow.
6. **P1-P4 priorities, Wednesday urgent-payment cutoffs, contract alerts, missing invoice/acta deadlines**, complete supplier registration by Treasury, and investment management.
7. Digital-acta signature PDF export, signed partial-reception/accounting adjustment and legal review of whether the application sign-offs meet institutional requirements.
8. Runtime/end-to-end tests with real dependencies and an isolated MongoDB database, including negative access-control tests and regression tests for pre-existing records.

## How to apply
1. Back up your project **and MongoDB**. Commit the baseline in Git before replacing files.
2. Unzip `UMA_PDF_Updated_Full_Source.zip` into a *new folder* instead of directly overwriting production. Alternatively copy the complete files from `UMA_PDF_Changed_Full_Files.zip` into the identical relative paths.
3. Review `UMA_PDF_Code_Changes.patch` before merging. No source files were deleted.
4. Install your project's required dependencies: from its root use `npm ci` (with network access).
5. Execute `npm test`, `npm run build`, and end-to-end tests with a **staging** MongoDB.
6. Set the real staff job categories and supervisors in User Administration. Test 3,5,6 and a disallowed category.
7. Test A1/B/A2 evidence submission with strict mode in staging before enabling it in production.
8. Test an issue/sign acta flow with requester, supervisor and Vice-Rector accounts. Ensure GAF can release a bank TXT and Accounting cannot.
9. Confirm approved migration changes with UMA Finance before deployment.

## Validation in this environment
- JavaScript backend syntax: checked with `node --check` on changed backend/shared files.
- Changed JSX syntax: parsed with the installed TypeScript parser.
- `node --test backend/test/businessCalendar.test.js`: **2 tests passed**.
- Complete application tests, build and runtime MongoDB integration: **not run** (dependencies unavailable in this session). The entire update is not production-validated.

## Source-of-truth clarification
This code was aligned against the seven-page user manual PDF, **not** the interactive HTML prototype. Any business ambiguity (for example what day replaces a non-working 15th, or who the actual CECO head is) is called out instead of guessed.
