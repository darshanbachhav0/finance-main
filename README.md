# UMA — Assign employees' primary cost centers

This package is compatible with the existing `finance-main` React + Express/MongoDB project. It contains an offline-reviewed JSON mapping drawn from **data em.xlsx** (266 employees) and checked against **Centro de Costo - Tesoreria.xlsx**.

## Safety / provenance

- Primary source: **data em.xlsx** (266 employee primary cost centers; 43 different codes).
- Cross-checked: 143 employees agree with Treasury; 122 employees are only in the 266-row roster; one employee's codes disagree between sheets and is deliberately skipped.
- Uses **DNI** first, then numeric DNI-form `employeeCode`, not guesses from name.
- Fixes the one nine-digit source DNI using the exact-name, unique Treasury corroboration that was also used in the previous supervisor import.
- Never removes/deactivates a cost center or changes existing center budgets.
- Creates missing centers with a **transitional budget of 0**; existing center names and metadata are never overwritten.
- Changes only employee's primary `costCenter` and the `costCenterAssignment` provenance. Does not change `jefe`, role, jobTitle, jobCategory, area, `authorizedCostCenters`, existing requests or invoices.
- Ignores inactive employees and protected roles, and skips primary cost centers that exist but are inactive.
- Conflicting employee: DNI **44647124** has `20008` in the employee roster and `20012` in Treasury. Confirm the correct center with UMA before fixing via Admin > User Administration.
- Other center codes have inconsistent area/unit descriptions across employee rows; they appear as warnings in the validation JSON. The importer follows the numeric code rather than inferring a new one.
- This importer updates **existing MongoDB accounts only**. Records that are missing, ambiguous or protected are skipped and included in the report.
- Changes are logged to MongoDB `auditlogs`. An audit-write failure is reported but may leave an already-applied user update. No multi-document atomic transaction is claimed.

**Do not use the older `importUmaCostCenters.js --apply` for this task** without reviewing its deactivation behavior: it uses only the 153-row Treasury workbook and may deactivate centers missing from that file.

## Installation: extract into your existing repository root

The zip contains:

```
backend/scripts/assignUmaEmployeeCostCenters.js
data/uma-cost-center-assignments.json
README.md
```

## PowerShell commands

```powershell
cd "C:\Users\TI-SJL-0010\Downloads\finance-main-triple-track-updated\finance-main"
Expand-Archive -Path "$env:USERPROFILE\Downloads\UMA_Cost_Center_Assignment.zip" -DestinationPath "." -Force
cd .\backend
node .\scripts\assignUmaEmployeeCostCenters.js --validate-only
node .\scripts\assignUmaEmployeeCostCenters.js --dry-run --replace-existing
```

Read `backend/data/reports/uma-cost-center-assignment-dry_run-*.json` before applying. Confirm the correct database was used and understand any `skipped` users.

Stop the platform and workers before applying. **Only after confirming a successful MongoDB backup**, get the exact database name from your `.env`:

```powershell
$dbName = (node --input-type=module -e "import 'dotenv/config'; import mongoose from 'mongoose'; await mongoose.connect(process.env.MONGODB_URI); console.log(mongoose.connection.db.databaseName); await mongoose.disconnect();").Trim()
Write-Host "CHECK YOUR DATABASE BEFORE APPLYING: $dbName"
```

When correct and explicitly confirmed, run:

```powershell
node .\scripts\assignUmaEmployeeCostCenters.js --apply --file="..\data\uma-cost-center-assignments.json" --database="$dbName" --backup-confirmed --maintenance-confirmed --reviewed --replace-existing
```

The script displays `usersUpdated`, `usersAlreadyCorrect`, `usersSkipped`, `newCostCenters`, and a report file path.

Afterwards restart the platform and inspect Admin > User Administration > an employee's cost center. Resolve any flagged differences manually. Do not re-import automatically after an Admin has edited assignments unless you intentionally want the workbook to override Admin changes.
