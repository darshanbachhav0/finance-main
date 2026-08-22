# Official UMA Financial Formats - Gap Analysis

Date: 2026-08-18  
Scope: analysis only; no application code, schema, API, workflow, seed, or database data was changed.

## 1. Sources and Method

The following files were treated as the primary evidence for this analysis:

1. `data/Formato_Maestro_Requerimiento_CAPEX_OPEX.xlsx`
   - Sheet: `Maestro CAPEX OPEX`
   - Used range: `A1:G50`
   - One visible sheet; no hidden sheets, comments, named ranges, dropdown validations, or conditional formatting.
   - Formulas: `G36=D36*F36`, `G37=D37*F37`, `G38=D38*F38`, and `G39=SUM(G36:G38)`.
2. `data/Formato_Ficha_Homologacion_Nuevos_Proveedores.xlsx`
   - Sheet: `Ficha Nuevo Proveedor`
   - Used range: `A1:G43`
   - One visible sheet; no hidden sheets, comments, named ranges, formulas, dropdown validations, or conditional formatting.
3. `data/Formato_Rendicion_Gastos_UMA.xlsx`
   - Sheet: `Rendición de Gastos`
   - Used range: `A1:E31`
   - One visible sheet; no hidden sheets, comments, named ranges, dropdown validations, or conditional formatting.
   - Formulas: `E18=SUM(E14:E17)`, `E26=SUM(E23:E25)`, and `B31=E18+E26`.
4. `data/Manual_Simple_Formatos_Financieros_UMA.pdf`
   - Three pages, document code `GAF-MA-001`, version 1.0, July 2026.

All three workbook sheets and all three PDF pages were visually rendered and inspected. The repository review covered frontend routes/forms/details, backend routes/controllers/services, RBAC, request/supplier/rendition models, document rules, approval rules, budget/accounting/Treasury links, uploads, and tests.

## 2. Current Architecture Relevant to the Documents

| Layer | Current implementation |
|---|---|
| Frontend | React/Vite routes in `frontend/src/App.jsx`; request wizard in `frontend/src/pages/RequestCreate.jsx`; request record and rendition UI in `frontend/src/pages/RequestDetail.jsx`; supplier onboarding in `frontend/src/pages/Suppliers.jsx`; shared API client and role-aware navigation. |
| API | Express routers under `backend/src/routes`; relevant endpoints are `/api/requests`, `/api/requests/:id/rendition`, `/api/suppliers`, `/api/approvals`, `/api/budget`, `/api/accounting`, and `/api/treasury`. |
| Request domain | `FinancialRequest` is the single master request record. `requestService`, `workflowService`, `approvalService`, `budgetService`, `accountingService`, `renditionService`, and `treasuryService` operate on it. |
| Supplier domain | `Supplier` stores identity, coarse contact/compliance fields, documents, and legacy bank history. `SupplierBankAccount` stores dated bank-account records. `supplierService` proposes, reviews, homologates, warns about reused accounts, and deactivates suppliers. |
| Documents | `DocumentRule` plus `documentRuleService` applies configurable attachment requirements. Request files and supplier files use the existing protected local-storage pipeline. |
| Approvals | `ApprovalRule` resolves an area/amount/type route. The current enforced baseline is Area Director then Vice Rector, with optional Rectorate/Management and a separate budget stage. Sign-offs are authenticated and audited. |
| Financial controls | Cost Center and expense-account validation, dimensional budget commitments, CXP, balanced journals, Treasury batches, actual payment confirmation, reconciliation, period guards, and append-only audit already exist. |
| Roles | `Admin`, `Solicitor`, `Approver` with approval level, `Accounting`, `Treasury`, `Budget`, and `Management`. There is no separate `Compras/Logística`, `Control de Gestión`, or `CFO` role. |
| Baseline verification | `npm test` passed 43 backend and 15 frontend tests. `npm run build` completed successfully. Tests use isolated temporary databases and did not reset the existing application database. |

### Code Trace Index

| Concern | Existing code inspected |
|---|---|
| Routes and role-visible pages | `frontend/src/App.jsx`, `frontend/src/utils/navigationAccess.js`, `backend/src/routes/index.js` |
| Request capture/detail | `frontend/src/pages/RequestCreate.jsx`, `frontend/src/pages/RequestDetail.jsx`, `backend/src/models/FinancialRequest.js`, `backend/src/services/requestService.js`, `backend/src/routes/requestRoutes.js` |
| Request numbering and purchase orders | `backend/src/services/sequenceService.js`, `backend/src/models/PurchaseOrder.js`, `backend/src/services/purchaseOrderService.js` |
| Documents and uploads | `backend/src/models/DocumentRule.js`, `backend/src/services/documentRuleService.js`, `backend/src/middleware/upload.js`, `backend/src/services/storageService.js` |
| Supplier registration/homologation | `frontend/src/pages/Suppliers.jsx`, `backend/src/models/Supplier.js`, `backend/src/models/SupplierBankAccount.js`, `backend/src/services/supplierService.js`, `backend/src/routes/supplierRoutes.js` |
| SUNAT abstraction | `backend/src/services/sunatService.js`, `backend/src/integrations/sunat/ManualSunatProvider.js`, `backend/src/integrations/sunat/MockSunatProvider.js`, `backend/src/integrations/sunat/NotConfiguredSunatProvider.js` |
| Approval/sign-off | `backend/src/models/ApprovalRule.js`, `backend/src/services/approvalRuleService.js`, `backend/src/services/approvalService.js`, `backend/src/services/auditService.js`, `backend/src/routes/approvalRoutes.js` |
| Cost Center, account, and budget | `backend/src/services/accountingDimensionService.js`, `backend/src/models/ExpenseType.js`, `backend/src/models/CostCenter.js`, `backend/src/models/BudgetAllocation.js`, `backend/src/models/BudgetCommitment.js`, `backend/src/services/budgetService.js` |
| Rendition | Embedded `FinancialRequest.rendition`, `backend/src/services/renditionService.js`, `frontend/src/pages/RequestDetail.jsx`, `backend/src/routes/requestRoutes.js` |
| CXP/payment destination | `backend/src/models/AccountsPayable.js`, `backend/src/models/PaymentBatch.js`, `backend/src/services/treasuryService.js`, `backend/src/routes/treasuryRoutes.js` |
| Roles and authorization | `backend/src/utils/constants.js`, `backend/src/utils/permissions.js`, `backend/src/middleware/auth.js`, `backend/src/models/User.js` |
| Relevant automated coverage | `backend/test/requestRules.test.js`, `backend/test/permissions.test.js`, `backend/test/workflowIntegration.test.js`, `backend/test/financialLifecycle.test.js`, and `frontend/test` |

## 3. Requirements Extracted from Each Source

### 3.1 RCO-FOR-001 - Master CAPEX/OPEX Request

The workbook requires: use before any SolPed; CAPEX/OPEX choice; request date; area-correlative code; requester, area, Cost Center, and priority; request title; detailed scope; business justification; non-approval risk; CAPEX PEP/project, fixed-asset category, useful life, VAN/payback; OPEX account, frequency, and in/out-of-budget status; item/service lines with currency, quantity, unit, unit price, and total; suggested supplier and selection rationale; at least three quotations and technical-commercial evidence; and requester, area-management, and Control/CFO approvals.

### 3.2 RCO-FOR-002 - Supplier Registration/Homologation

The workbook requires: updated RUC file, legal-representative ID, and bank certificate; legal and commercial identity; person type; fiscal address/location/web; representative identity; separate commercial and logistics contacts; invoice currency; 30/45/custom credit term; goods/service profile; delivery method; up to three bank rows; current/detracción account type; account and 20-digit CCI; account currency; bank ownership matching the legal name; two compliance declarations; proceed/reject decision; `PRV-...` ERP code; and three review/sign-off responsibilities.

### 3.3 Official Rendition Format

The workbook requires: mandatory completion; `RG-2026-...` internal identifier; request date; beneficiary name, DNI/employee code, Cost Center/area, and UMA email; local-mobility lines with date, origin, destination, service purpose, and PEN amount; a stated S/41 daily limit; unsupported-expense lines with date, detailed concept, goods/service type, and gross PEN amount; exceptional-use statement; section totals; reimbursement bank and account/CCI; and a grand reimbursement total.

### 3.4 Practical PDF Manual

The manual adds or emphasizes: gray fields are fixed/Finance-only and white fields are editable; exact legal-name/RUC matching to active SUNAT registration; strict separation of commercial and logistics contacts; 30/45-day standard payment terms; mandatory Banco de la Nación account when detracción applies; exceptional use of unsupported expenses; limits set by Financial Management; beneficiary physical or digital signature; and a three-step practical flow of request/quotation, supplier onboarding/homologation, then ERP execution/closure.

## 4. Detailed Gap Analysis

The matrix contains 66 traceable items: 9 `EXISTING_AND_CORRECT`, 25 `EXISTING_NEEDS_CHANGE`, 16 `MISSING`, 7 `CONFLICT`, and 9 `NEEDS_BUSINESS_CLARIFICATION`. The eight D-items explicitly record differences between sources or between an official form and the current enforced workflow.

### A. CAPEX/OPEX Request Form and Procurement Data

| ID | Source / sheet / field | Requirement meaning | Existing support and code location | Classification | Exact change required |
|---|---|---|---|---|---|
| A01 | RCO-FOR-001 `A5:G6`; PDF p.1, Formato Maestro | The format is mandatory before a SolPed and requires technical-commercial support plus three quotations. | Attachments and configurable rules exist in `FinancialRequest`, `documentRuleService`, `RequestCreate`, and upload middleware. Three quotations are currently mandatory only for `GOODS`; services use invoice/contract/conformity rules. There is no SolPed record. | `CONFLICT` | Confirm whether three quotations apply to every CAPEX/OPEX request or only selected categories/thresholds. Configure `DocumentRule` after approval; do not remove current category-specific evidence. Decide whether SolPed is an external reference or a new field/entity. |
| A02 | RCO-FOR-001 `A12:G12`; PDF p.1, Tipo de Requerimiento | Classify the request as CAPEX or OPEX. | `REQUEST_TYPE`, `FinancialRequest.requestType`, backend accounting mappings, and the wizard support CAPEX/OPEX while retaining other special request types. | `EXISTING_AND_CORRECT` | No model replacement. Keep the broader controlled taxonomy and present CAPEX/OPEX as the applicable choices for this form. |
| A03 | RCO-FOR-001 `A9:G11` | Capture request date, requester, area/department, Cost Center, and priority. | Date, area, Cost Center, priority, and authenticated requester exist in `FinancialRequest`, `User`, `RequestCreate`, and `accountingDimensionService`. Cost Center access is server-enforced. | `EXISTING_AND_CORRECT` | Only align Spanish labels and printed/form-view grouping with RCO-FOR-001. |
| A04 | RCO-FOR-001 `E9:G9`, “Código Requerimiento: Correlativo del área” | Number requests using an area correlativo. | `sequenceService.nextRequestNumber` generates a safe global `SOL-YYYY-XXXXX`; `FinancialRequest.requestNumber` is immutable and unique. It is not area-specific. | `CONFLICT` | Do not replace historical/global numbers without approval. Decide whether the official field should display the global SOL number or whether a separate `areaCorrelative` is required. |
| A05 | RCO-FOR-001 `A15:G16`, Título del Requerimiento | Store a short request title distinct from detail. | Only `FinancialRequest.description` exists; the wizard has one Description field. | `MISSING` | Add `title` to the existing request model/payload/list/detail/search; migrate old records with a non-destructive fallback derived from description. |
| A06 | RCO-FOR-001 `A17:G18`, Descripción Detallada | Store scope, specifications, or deliverables. | `FinancialRequest.description` partly covers purpose and payment description but is not separated from justification. | `EXISTING_NEEDS_CHANGE` | Add a dedicated `detailedDescription` or clearly define `description` as this field, while preserving old values. |
| A07 | RCO-FOR-001 `A19:G20`; PDF p.1, Sustento Técnico-Comercial | Explain need, operational problem, and direct benefit. | The wizard Description placeholder asks for business purpose, but no separate structured justification exists. | `EXISTING_NEEDS_CHANGE` | Add `businessJustification`; show and validate it in create/edit/review/detail. Preserve `description` for historical compatibility. |
| A08 | RCO-FOR-001 `A21:G22`, Análisis de Riesgo | Record impact if the request is not approved. | No request schema or UI field. | `MISSING` | Add `nonApprovalRisk` and display it in approval/detail/print views. Clarify whether it is mandatory for all requests. |
| A09 | RCO-FOR-001 `A25:C27`, Código de Proyecto/PEP | Identify the CAPEX project/PEP. | A `Project` master and `FinancialRequest.project` code exist; line `projectId` is an unvalidated string. There is no explicit PEP semantic. | `EXISTING_NEEDS_CHANGE` | Reuse the Project master; add/confirm a PEP code field and store an immutable snapshot. Do not create a parallel project module. |
| A10 | RCO-FOR-001 `D26:G26`, Categoría de Activo Fijo | Choose Infrastructure, Machinery, IT/Hardware, or Licenses/Software for CAPEX. | `expenseNature` has Infrastructure, Equipment, and Technology, but does not exactly represent the fixed-asset categories. | `EXISTING_NEEDS_CHANGE` | Add a CAPEX-only controlled `assetCategory` or configurable mapping to existing expense natures; do not overload workflow type. |
| A11 | RCO-FOR-001 `A27:C27`, Vida Útil | Record estimated useful life in years. | No field or validation. | `MISSING` | Add CAPEX-only `usefulLifeYears` with positive numeric validation; clarify whether optional or mandatory by asset category. |
| A12 | RCO-FOR-001 `D27:G27`, VAN/Payback | Record investment-return metrics. | No VAN, payback, or ROI fields/calculations. | `MISSING` | Add optional structured values only after Finance defines units, currency, discount rate, and whether the ERP calculates or merely records them. |
| A13 | RCO-FOR-001 `A29:C31`, Cuenta Contable | Assign the OPEX ledger/expense account. | `ExpenseType.accountNumber`, accounting mappings, request lines, and backend OPEX/Class 6 validation implement this. | `EXISTING_AND_CORRECT` | Use the existing expense-account selector and snapshot. |
| A14 | RCO-FOR-001 `D30:G30`, Frecuencia del Gasto | Mark one-off, monthly recurring, or annual/renewal OPEX. | No recurrence/frequency field. | `MISSING` | Add an OPEX-only configurable frequency enum and include it in detail/reporting. Clarify whether recurring requests generate schedules. |
| A15 | RCO-FOR-001 `A31:G31`, Estatus Presupuestal | Show whether expenditure is within approved budget; outside-budget requires Director approval. | The budget engine calculates actual dimensional availability and exceptions. The request form does not expose this exact derived status, and exception approval is handled by Budget/configured rules rather than a simple requester checkbox. | `EXISTING_NEEDS_CHANGE` | Show a backend-derived budget preview/status. Do not trust user-entered budget status. Confirm how “VoBo Dirección” maps to existing Budget/extraordinary approval rules. |
| A16 | RCO-FOR-001 `A34:G38`, item/service breakdown | Store description, currency, quantity, U.M., unit price, and calculated total per commercial line. | Existing request lines store Cost Center, expense account, net, IGV, total, and PEN equivalent. They do not store procurement quantity/U.M./unit price/item description. | `EXISTING_NEEDS_CHANGE` | Extend the existing line schema and wizard with optional/required procurement fields; calculate line commercial total with decimal-safe helpers and reconcile it to fiscal/accounting totals. Do not create a second line collection unless business rules require it. |
| A17 | RCO-FOR-001 `G36:G39`, formulas | Calculate each line total and total required. | Existing model calculates accounting totals and rejects Net+IGV mismatch using money helpers. | `EXISTING_AND_CORRECT` | Retain authoritative backend totals; add quantity × unit price reconciliation if A16 is approved. |
| A18 | RCO-FOR-001 `A41:G41`, Proveedor Sugerido | Associate a suggested/selected supplier. | `FinancialRequest.supplier` is required and the wizard searches homologated suppliers. | `EXISTING_AND_CORRECT` | Relabel as suggested/selected supplier where appropriate; retain the real supplier reference and snapshot. |
| A19 | RCO-FOR-001 `A42:G44`, Sustento de Elección | Explain supplier selection by price, delivery, exclusivity, etc. | No dedicated field. | `MISSING` | Add `supplierSelectionReason`, show it to approvers, and require it when a supplier is selected from quotations according to approved rules. |
| A20 | RCO-FOR-001 `A46:G50`, authorization signatures | Obtain requester, Area Management, and Control de Gestión/CFO sign-offs. | Authenticated sign-off, audit, configurable rules, Director/Vice Rector/Management roles exist. The backend explicitly requires the Area Director and Vice Rector baseline before budget commitment. There is no Control de Gestión/CFO identity. | `CONFLICT` | Business must map each form signatory to an existing role/approval level and decide whether Vice Rector remains mandatory. Then reconfigure the existing approval engine; do not build a second workflow. |
| A21 | PDF p.3, Step 3 | After supplier coding, permit an Order of Purchase/Service and exact payment to validated accounts. | `PurchaseOrder` and `purchaseOrderService` generate `OC-YYYY-XXXXX`, but only for approved `PAGO_CON_COTIZACION`. Treasury uses bank-account snapshots. | `EXISTING_NEEDS_CHANGE` | Confirm which CAPEX/OPEX types create purchase/service orders and whether an external SolPed reference is needed; extend the existing PO service only after confirmation. |

### B. Supplier Master and Homologation

| ID | Source / sheet / field | Requirement meaning | Existing support and code location | Classification | Exact change required |
|---|---|---|---|---|---|
| B01 | RCO-FOR-002 `A5:G6` | Require updated RUC file, representative ID, and official bank certificate. | Exact document kinds exist in `Supplier.documents`; upload middleware and `assertSupplierCanBeHomologated` block homologation when missing. | `EXISTING_AND_CORRECT` | Keep current protected storage and validation; align labels to the official form. |
| B02 | RCO-FOR-002 `A9:G10`, Razón Social/RUC/Tipo de Persona | Store legal name, 11-digit RUC, and Jurídica/Natural con Negocio. | Legal name and unique 8/11-digit RUC/DNI exist. `identifierType` distinguishes RUC/DNI, not legal person type. | `EXISTING_NEEDS_CHANGE` | Add `personType`; retain identifier type and DNI support. Apply 11-digit validation only when identifier type is RUC. |
| B03 | RCO-FOR-002 `A11:G13`; PDF p.2, Razón Social y RUC | Match legal identity exactly with active SUNAT registration. | Manual/mock/provider abstractions exist, but supplier homologation currently uses authorized checkbox-style taxpayer/compliance decisions and does not compare returned SUNAT legal name/address. | `EXISTING_NEEDS_CHANGE` | Store validation source/result and legal-name match. Keep manual mode honest when production SUNAT is not configured; do not claim live SUNAT validation. |
| B04 | RCO-FOR-002 `A10:D10`, Nombre Comercial | Store trade/commercial name separately. | `Supplier.name` and `legalName` exist but are currently defaulted to each other; their semantics are not enforced in UI. | `EXISTING_NEEDS_CHANGE` | Define `name` as trade name or add `commercialName`, migrate without discarding either historical value, and label both clearly. |
| B05 | RCO-FOR-002 `A11:G12`, address/location/web | Store fiscal address, district/province/department, and website. | Fiscal/tax address exists. Structured location and website are absent. | `EXISTING_NEEDS_CHANGE` | Add structured location fields and optional website; preserve existing free-text address. |
| B06 | RCO-FOR-002 `A13:G13`, representative | Store representative name and DNI/CE. | Representative name and uploaded ID file exist; the representative document number/type do not. | `EXISTING_NEEDS_CHANGE` | Add representative document type/number with format validation. |
| B07 | RCO-FOR-002 `A16:G17`; PDF p.2, Contactos Operativos | Store commercial contact name, position, mobile, and email. | One generic `contactName`, `phone`, and `email` exists; no position or explicit commercial grouping. | `EXISTING_NEEDS_CHANGE` | Convert or extend to a `commercialContact` structure while preserving legacy fields during migration. |
| B08 | RCO-FOR-002 `A18:G19`; PDF p.2, Contactos Operativos | Store a separate logistics/operations contact. | No separate operations contact. | `MISSING` | Add `operationsContact` with name, position, mobile, and email; display separately. |
| B09 | RCO-FOR-002 `A22:D22`, Moneda de Facturación | Store PEN/USD billing currency. | `Supplier.currency` supports PEN/USD. | `EXISTING_AND_CORRECT` | Relabel as billing currency. |
| B10 | RCO-FOR-002 `E22:G22`; PDF p.2, Condiciones de Pago | Store 30, 45, or custom credit days. | `AccountsPayable.dueDate` exists, but Supplier has no payment-term policy and AP does not derive due date from it. | `MISSING` | Add supplier payment terms and define how due date is calculated/snapshotted on CXP creation. |
| B11 | RCO-FOR-002 `A23:G23`, Tipo Bien/Servicio | Describe supplier business line/core offering. | Generic `supplierType` exists without controlled semantics. | `EXISTING_NEEDS_CHANGE` | Clarify whether this is a category, free-text description, or both; reuse `supplierType` where possible. |
| B12 | RCO-FOR-002 `A24:G24`, Método de Entrega | Record central warehouse, destination site, or other delivery method. | No field. | `MISSING` | Add controlled delivery method plus optional “other” text. |
| B13 | RCO-FOR-002 `A28:G31`, three bank rows | Maintain up to three usable supplier accounts. | Bank history exists, but `replaceActiveBankAccount` deactivates every active account before creating one, so only one active account is supported. | `CONFLICT` | Confirm whether multiple accounts may be active simultaneously by bank/currency/type. Then change the existing bank-account service/index policy without deleting history. |
| B14 | RCO-FOR-002 `B29:B31`; PDF p.2, Detracción | Distinguish current and detracción accounts; require Banco de la Nación when applicable. | `SupplierBankAccount` has no account type. `BANKS` excludes Banco de la Nación, so such an active payment account cannot be represented. | `MISSING` | Add configurable bank master/`BANCO_NACION` and `accountType`; define detracción applicability and who validates it before implementing enforcement. |
| B15 | RCO-FOR-002 `C29:F31`, account/CCI format | Store account without hyphens and a 20-digit CCI. | Account/CCI are stored and duplicate-use warnings exist, but exact numeric/length normalization is not enforced in model/service. | `EXISTING_NEEDS_CHANGE` | Normalize and validate account/CCI server-side; retain bank-specific exceptions only if UMA supplies rules. |
| B16 | RCO-FOR-002 `G28:G31`, account currency | Store PEN/USD per bank account. | `SupplierBankAccount.currency` supports PEN/USD. | `EXISTING_AND_CORRECT` | Preserve account-level currency. |
| B17 | RCO-FOR-002 `A27:G27`, account ownership | Ensure each bank account belongs to the exact legal name. | Bank certificate is required, but there is no account-holder field or explicit ownership decision. | `MISSING` | Add account-holder/ownership validation result, reviewer, source document, date, and comments. |
| B18 | RCO-FOR-002 `A34:G34`; PDF p.2, Compliance | Declare sanctions/inhabilitations/processes with the State. | Only a coarse compliant/non-compliant flag and comments exist. | `EXISTING_NEEDS_CHANGE` | Store the answer and review result separately; clarify whether “sanctions” and “processes in force” are one or two questions. |
| B19 | RCO-FOR-002 `A35:G35`, compliance officer/model | Declare whether a prevention/compliance model exists. | No dedicated field. | `MISSING` | Add the declaration and preserve reviewer decision/comments independently. |
| B20 | RCO-FOR-002 `A38:D38`, procede/rechazado | Record onboarding outcome. | Homologation supports HOMOLOGATED, OBSERVED, and INACTIVE; review actor/date/comments are audited. | `EXISTING_AND_CORRECT` | Map “PROCEDE SU ALTA” to HOMOLOGATED and “RECHAZADO” to an agreed status; clarify whether OBSERVED remains available. |
| B21 | RCO-FOR-002 `E38:G38`; PDF p.3, `PRV-XXXX` | Generate a unique ERP supplier code. | Mongo `_id` exists, but no human-readable supplier code or atomic supplier sequence exists. | `MISSING` | Add immutable unique `supplierCode` using the existing atomic sequence service, plus non-destructive migration for existing suppliers. |
| B22 | RCO-FOR-002 `A41:G43`, three sign-offs | Record Compras/Logística justification, Control de Gestión compliance, and Finance Manager final approval. | One Accounting/Admin review/homologation event exists; the three distinct responsibilities are not modeled. | `CONFLICT` | Map responsibilities to current roles or add permissions/approval levels. Do not add new roles until UMA confirms ownership and segregation of duties. |
| B23 | PDF pp.1-3, supplier before adjudication | Send the form to a new supplier and homologate before adjudication/PO/payment. | Solicitor can propose; Accounting/Admin homologates; only homologated suppliers are selectable/submittable; Treasury uses validated account snapshots. | `EXISTING_NEEDS_CHANGE` | Clarify whether a pending supplier may be referenced by a draft request. Reuse the current proposal/homologation flow and retain payment blocking. |

### C. Rendition and Unsupported Expense Format

| ID | Source / sheet / field | Requirement meaning | Existing support and code location | Classification | Exact change required |
|---|---|---|---|---|---|
| C01 | Rendition `A3:E3` | Complete all blank fields before presentation. | Current rendition requires accounting lines, amounts, evidence, ownership, open period, and zero balance before validation. It does not contain all official fields. | `EXISTING_NEEDS_CHANGE` | Define field-level mandatory rules after C14 scope is resolved; enforce on backend, not only UI. |
| C02 | Rendition `A6:B6`, ID Rendición `RG-2026-...` | Generate an internal immutable rendition number. | Rendition is embedded in a request and identified only by `SOL-...`; no RG sequence. | `MISSING` | Add `rendition.number` using the existing atomic sequence service, preserving the parent request number. |
| C03 | Rendition `C6:E9`, applicant identity | Store date, name, DNI/employee code, Cost Center/area, and UMA email. | Requester, date, area, Cost Center, name, and email are available through Request/User snapshots. User has no employee code or DNI field. | `EXISTING_NEEDS_CHANGE` | Add employee identifier fields to User or an immutable rendition beneficiary snapshot; clarify whether personal DNI may be stored and who may view it. |
| C04 | Rendition `A11:E17`, local mobility lines | Record date, origin, destination, commission/service reason, and PEN amount per trip. | Current rendition lines are accounting lines with Cost Center, expense account, Net, IGV, and Total. Mobility-specific fields do not exist. | `MISSING` | Extend the existing rendition structure with typed detail lines; do not create a parallel payment workflow. |
| C05 | Rendition `A12:E12`, S/41 daily maximum | Apply or communicate the stated daily mobility threshold. | No daily mobility-cap rule exists. | `NEEDS_BUSINESS_CLARIFICATION` | UMA Finance/legal must confirm the amount, effective date, aggregation method, and whether it blocks, warns, or affects deductibility. Implement as dated configuration, not hard-coded text. |
| C06 | Rendition `A18:E18`, mobility total | Sum mobility amounts. | Current rendition calculates total rendered from accounting-line totals, but has no mobility subtotal. | `EXISTING_NEEDS_CHANGE` | Add decimal-safe mobility subtotal and reconcile it to accounting lines. |
| C07 | Rendition `A20:E25`, unsupported lines | Record date, detailed concept, goods/service type, and gross PEN amount. | `REEMBOLSO_SIN_SUSTENTO` and non-deductible accounting mappings exist, but structured unsupported-expense details do not. | `EXISTING_NEEDS_CHANGE` | Add typed unsupported-expense detail lines and map totals to the existing non-deductible accounting path. |
| C08 | Rendition `A21:E21`; PDF p.2 | Allow unsupported expenses only exceptionally when valid vouchers are impossible. | Current request type is selectable and requires generic authorization evidence; no explicit exception declaration/decision is stored. | `EXISTING_NEEDS_CHANGE` | Add requester declaration plus authorized review decision/comments. Clarify approver and evidence threshold. |
| C09 | Rendition `A26:E26`, unsupported total | Sum unsupported gross amounts. | Current overall rendered total exists; no dedicated unsupported subtotal. | `EXISTING_NEEDS_CHANGE` | Add decimal-safe category subtotal and reconcile to accounting totals. |
| C10 | Rendition `A28:E30`, reimbursement bank/account | Select reimbursement bank and account/CCI. | Supplier bank accounts exist for vendor payments. Employee/beneficiary reimbursement bank accounts are not modeled. | `MISSING` | Clarify whether this data belongs to User, a protected employee-bank profile, or a rendition-only encrypted snapshot. Do not reuse Supplier incorrectly. |
| C11 | Rendition `A31:E31`, net total | Total reimbursement equals mobility plus unsupported expenses. | Current `amountRendered`, `amountReturned`, and balance logic exists, but not the official category formula. | `EXISTING_NEEDS_CHANGE` | Add category reconciliation: mobility + unsupported = requested reimbursement, then reconcile to advance/rendered/returned amounts where applicable. |
| C12 | PDF p.2, Monto Consumido | Record exact PEN amount and comply with Financial Management limits for non-deductible expenses. | PEN amounts and non-deductible account mapping exist. No configurable management-limit rule exists. | `NEEDS_BUSINESS_CLARIFICATION` | Obtain threshold(s), scope, effective dates, and exception behavior; then add configurable backend rules. |
| C13 | PDF p.2, Firma del Beneficiario | Capture physical or digital beneficiary acknowledgment. | Rendition submission records authenticated user, timestamp, IP, audit, and an internal signature reference through `workflowEvent`, but the UI/model does not identify this explicitly as beneficiary acknowledgment or support physical signature evidence. | `EXISTING_NEEDS_CHANGE` | Surface the authenticated sign-off as beneficiary acknowledgment and optionally permit a signature document if UMA requires it. Do not call it a certified digital signature. |
| C14 | Workbook title/sections versus current request types | Decide whether the official form belongs to Entrega a Rendir, Reembolso sin Sustento, both, or a distinct combination. | Current rendition upload/review is only available after payment for `ENTREGA_RENDIR`; `REEMBOLSO_SIN_SUSTENTO` is a separate normal request/accounting path. | `NEEDS_BUSINESS_CLARIFICATION` | Business must map the official form to existing request types and lifecycle points before schema/UI changes. Keep one master request state machine. |

### D. Cross-Document Differences and Unclear Rules

| ID | Difference | Classification | Required decision |
|---|---|---|---|
| D01 | PDF p.1 requires a “Cuadro de Cotizaciones” containing amounts, terms, and conditions for three suppliers. RCO-FOR-001 has only three commercial item rows, one suggested supplier, and an instruction to attach three quotations; it has no three-supplier comparison fields. | `NEEDS_BUSINESS_CLARIFICATION` | Decide whether the ERP must store a structured quotation comparison or only require three uploaded quotation files plus a selection rationale. |
| D02 | RCO-FOR-001 signature row names Solicitor, Area Management, and Control de Gestión/CFO. The current system requires Area Director and Vice Rector before Budget; the PDF’s three practical steps do not mention Vice Rector. | `CONFLICT` | Approve an exact role/sequence mapping before changing approval rules. |
| D03 | RCO-FOR-002 asks two compliance questions. PDF p.2 explains only sanctions/inhabilitations/processes and omits the compliance-officer/model question. | `NEEDS_BUSINESS_CLARIFICATION` | Confirm both questions remain mandatory and define how each affects homologation. |
| D04 | The rendition workbook covers both local mobility and unsupported expenses and includes bank data. PDF p.2 describes only unsupported special expenses and adds beneficiary signature, which is absent from the workbook. | `NEEDS_BUSINESS_CLARIFICATION` | Confirm whether the workbook is authoritative for combined scope and whether the PDF signature is mandatory. |
| D05 | The rendition workbook states S/41/day and “SUNAT 2026”; the PDF only says to follow limits set by Financial Management. | `NEEDS_BUSINESS_CLARIFICATION` | Obtain formal legal/accounting confirmation and effective-date policy before implementing any tax limit. |
| D06 | RCO-FOR-002 offers three bank rows and current/detracción accounts, while the current ERP intentionally keeps one active supplier payment account and historical replacements. | `CONFLICT` | Define simultaneous active-account selection rules and the role responsible for choosing the payment account. |
| D07 | PDF p.3 says the PRV code permits Order of Purchase/Service; current implementation generates a PO only for `PAGO_CON_COTIZACION`. | `NEEDS_BUSINESS_CLARIFICATION` | Identify which request types and thresholds require an order and whether service orders differ from purchase orders. |
| D08 | The source files call themselves official and include fixed version/date codes, but do not state whether the ERP must generate downloadable forms matching the templates. | `NEEDS_BUSINESS_CLARIFICATION` | Decide whether digital capture alone is sufficient or whether versioned Excel/PDF export is required. |

## 5. Database Changes That May Be Required

No database change should be made before the D-series decisions are approved. Likely non-destructive extensions are:

- `FinancialRequest`: title, business justification, non-approval risk, CAPEX details, OPEX frequency, supplier-selection reason, optional area correlativo, form code/version, and procurement attributes on existing lines.
- `Supplier`: immutable `supplierCode`, person type, commercial name semantics, structured location, website, representative document, separate commercial/operations contacts, payment terms, delivery method, explicit compliance declarations, and staged homologation decisions.
- `SupplierBankAccount`: account type, account holder/ownership decision, Banco de la Nación/configurable bank support, and an approved multi-active-account policy.
- Existing embedded `FinancialRequest.rendition`: rendition number, beneficiary snapshot, typed mobility/unsupported lines, category totals, bank snapshot, declarations, and beneficiary acknowledgment.
- Migrations must be additive, repeatable, preserve historical values, and report records that cannot be mapped. No collection reset or historical reinterpretation is appropriate.

## 6. UI Changes That May Be Required

- Extend the existing request wizard with conditional CAPEX/OPEX sections and procurement attributes; keep accounting lines as the financial source of truth.
- Add a derived budget-status preview instead of a user-controlled financial-status checkbox.
- Expand Supplier create/review into the official six sections, including separate contacts, bank rows, declarations, and staged sign-off visibility.
- Extend the existing Request Detail rendition panel with typed mobility/unsupported entries, beneficiary snapshot, totals, declaration, and sign-off.
- Add official-form print/export only if D08 is approved.
- Add every new visible label in English and Spanish; maintain existing keyboard/focus behavior and server-side error display.

## 7. API and Backend Changes That May Be Required

- Extend the existing `/api/requests` create/update/detail payloads; keep submission validation in `requestService` and `documentRuleService`.
- Extend `/api/suppliers` payloads and `supplierService`; add server validation for CCI/account formatting, declaration decisions, supplier code, and approved bank-account multiplicity.
- Extend `/api/requests/:id/rendition`; keep owner, period, evidence, amount, accounting mapping, and audit checks in `renditionService`.
- Reuse `sequenceService` for optional area correlativo, `PRV-...`, and `RG-...` references.
- Reuse `ApprovalRule`/approval route snapshots after role mapping is approved. Remove no baseline approval without explicit business approval and migration analysis.
- Add focused tests for every added field rule, quotation scope, supplier sign-offs, bank selection, rendition caps/totals, permissions, and migrations.

## 8. Workflow Changes That May Be Required

1. Draft request captures official RCO-FOR-001 fields and procurement evidence.
2. A pending supplier may be proposed through the existing Supplier module; whether the draft may reference it is unresolved.
3. Supplier homologation captures the RCO-FOR-002 decisions before adjudication/payment.
4. Approval continues through the existing single workflow, but its exact Area/Vice Rector/Control/CFO mapping requires approval.
5. Budget remains authoritative and derived; outside-budget requests use the existing exception mechanism after rule mapping.
6. Purchase/service order generation remains inside the existing PO service and occurs only for approved request types.
7. Rendition remains part of the existing request lifecycle; the official form must be mapped to Entrega a Rendir and/or Reembolso sin Sustento before implementation.

## 9. Permission Changes That May Be Required

- Current Solicitor proposal plus Accounting/Admin homologation is close to the manual, but “Compras/Logística,” “Control de Gestión,” and “CFO/Gerencia de Administración y Finanzas” do not have direct role equivalents.
- Do not add roles based only on labels in a paper form. First decide whether they map to `Accounting`, `Budget`, `Approver`, `Management`, or custom permissions.
- If suppliers complete data externally, a secure invitation/public onboarding flow would require separate security design; the documents do not define authentication for external providers.
- Employee DNI and reimbursement bank data require an explicit privacy/access decision before storage.

## 10. Proposed Implementation Plan (Pending Approval)

### Phase 0 - Business Decisions

Resolve D01-D08, especially quotation scope, approval mapping, rendition type mapping, tax/management limits, simultaneous bank accounts, and official export requirements.

### Phase 1 - Additive Schema and Migration Design

Add approved fields to existing models, indexes, snapshots, atomic sequences, dry-run migration, and migration report. Preserve all existing records and APIs through compatibility mapping.

### Phase 2 - Supplier Official-Form Alignment

Extend Supplier UI/API/service, bank account policy, declarations, review events, PRV sequence, and permissions. Add tests before enabling stricter homologation.

### Phase 3 - Request Official-Form Alignment

Extend the wizard/detail/list/search with title, justification, risk, CAPEX/OPEX conditional data, commercial line attributes, quotation selection rationale, and derived budget status.

### Phase 4 - Rendition Official-Form Alignment

Extend the existing rendition payload/UI/service with RG reference, beneficiary snapshot, typed expense lines, totals, declaration, and sign-off. Apply only approved dated limit rules.

### Phase 5 - Workflow and Order Mapping

Configure the approved signatory mapping in the existing approval engine and extend PurchaseOrder scope without creating another state machine.

### Phase 6 - Verification and Documentation

Run migrations in dry-run, backend/frontend tests, production build, role-by-role workflow tests, and update English/Spanish user documentation to match the implemented decisions.

## 11. Analysis Conclusion

The current ERP already implements the controlled financial lifecycle and many stronger controls that the four source documents do not describe, including backend RBAC, document rules, budget commitments, CXP, journals, Treasury confirmation, reconciliation, period blocking, and immutable audit. These should be preserved.

The principal confirmed gaps are official procurement attributes, structured quotation comparison/selection rationale, supplier commercial/contact/payment/compliance details, simultaneous current/detracción bank-account handling, PRV/RG references, and structured mobility/unsupported-expense rendition fields. Approval roles, quotation scope, rendition scope, tax/management limits, and official-form export remain unresolved and must not be guessed.

No implementation should begin until the business clarification items in section 4D are approved.
