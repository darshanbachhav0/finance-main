# UMA Integrated CAPEX / OPEX / Accounts Payable Management System

## Bilingual User and Operations Manual / Manual Bilingüe de Usuario y Operaciones

Version: 2026-08-11

---

# Part I - English

## 1. What the System Does

The system controls one institutional expense from the first request until final accounting close. It keeps the request, supplier evidence, approvals, budget, accounting records, payment instructions, bank confirmation, reconciliation, and audit history connected under one request number.

The normal path is:

`Draft -> Validate -> Submit -> Director -> Vice Rector -> Budget -> Accounting/CXP -> Treasury schedule -> Bank TXT -> Real payment confirmation -> Reconciliation -> Close`

Generating a bank TXT is not payment. Treasury must confirm the operation after the bank has really executed it.

## 2. Sign In and Main Screen

Open the local or shared HTTPS address and enter your email and password. Inactive users cannot sign in.

The main screen has:

- **Left navigation:** pages allowed for your role. Use the arrow at the bottom to collapse it. On a phone, use the menu icon to open the drawer.
- **Page title and breadcrumbs:** show where you are.
- **EN/ES:** changes all interface labels between English and Spanish.
- **Bell:** shows pending tasks and notifications for your role.
- **User menu:** shows your name, role, area, and Log out.
- **Three-dot menu:** shows actions for one table row. On mobile it opens as a bottom action sheet.

Tables support Search, column filters, sorting, rows per page, previous/next page, result count, and Clear filters. Use the checkboxes where bulk selection is available.

### Faster navigation and personal table setup

- Press **Ctrl/Cmd+K** or `/` outside a form field to search authorized pages and exact request references. Use Arrow keys, Home/End, Enter, or Escape.
- Choose **Compact** or **Comfortable** density from a table toolbar. The preference applies across operational tables.
- Use **Save current view** to name the current search, filters, sorting, density, and page size on this device. Select it later from **Saved views**, or delete it with the adjacent delete icon.
- Returning from Request Detail preserves the Requests search, filters, sorting, page, and page size for the browser session.
- On tablet/mobile, select **Filters** to expand table filters. Three-dot actions open as a focus-managed bottom sheet.

## 3. Roles and Access

| Role | Main work |
|---|---|
| Admin | Users, technical/master configuration, all records, and audited overrides. |
| Solicitor | Own requests, drafts/corrections, supplier proposals, and renditions. |
| Approver - Area Director | Requests assigned to the Director level. |
| Approver - Vice Rector | Requests assigned to the Vice Rector level. |
| Accounting | Supplier homologation, periods, fiscal processing, CXP, journals, FX, SIRE, and audit. |
| Treasury | Payable scheduling, bank files, actual payment confirmation, and reconciliation. |
| Budget | Allocations, commitments, exceptions, and budget monitoring. |
| Management | Executive dashboards/reports and configured extraordinary approvals. |

The server checks permission again for every action. Seeing or hiding a button is not the only protection.

## 4. Dashboard

The Dashboard changes by role.

- **Solicitor:** drafts, observed/returned work, approvals in progress, rendition tasks, and recent requests.
- **Approver:** pending count, PEN amount waiting, oldest item, SLA severity, and recent decisions.
- **Accounting:** open period, fiscal queue, CXP, debit/credit totals, missing rates, and closing work.
- **Treasury:** payable queue, PEN/USD totals, missing bank details, recent files, confirmations, and reconciliation.
- **Budget:** Assigned, Committed, Executed, Paid, Available, and low-balance/exception alerts.
- **Management:** global execution, CAPEX versus OPEX, area/project trends, and pending commitments.
- **Admin:** system totals, users, workflow health, master-data warnings, and activity.

Select a task or table row to open the related page.

Dashboards show **Last updated** and **Refresh**. Charts provide exact hover values, click-through to filtered requests where available, and **View exact data** for an accessible table. Management Reports adds period/date, currency, request type, area, Cost Center, and project filters; previous-period comparison; budget execution; CAPEX/OPEX; monthly/yearly trends; area/project/account/supplier analysis; lifecycle and SLA; CXP ageing; Treasury schedule; rendition; reconciliation; exceptions; and period-close readiness.

## 5. Create or Correct a Request

Go to **Requests** and select **New request**. The wizard has four steps.

### Step 1 - Basic information

Choose Request Type, Expense Nature, issue date/period, supplier, priority, currency, project if applicable, and enter a clear business justification. The system suggests the Solicitor's Cost Center. A Solicitor can use another Cost Center only if it is authorized in the user profile.

Request types are OPEX, CAPEX, Entrega a Rendir, Reembolso con Sustento, Reembolso sin Sustento, and Pago con Cotizacion. Expense Nature describes what is being purchased; it is separate from workflow type.

For USD, an exact rate for the issue date is required. PEN always uses 1.

### Step 2 - Accounting lines

Add one or more lines. Every line needs:

- Cost Center.
- Expense Type/ledger account.
- Net.
- IGV.
- Total.

The system calculates totals and PEN equivalent. It warns if Net + IGV is not Total. OPEX, CAPEX, and unsupported reimbursement account mappings are validated by the backend.

### Step 3 - Documents

The page explains the documents required by the selected type/nature. Examples:

- Goods: at least three quotations plus invoice/voucher; purchase order where applicable.
- Services: invoice, signed contract, and conformity/report.
- Pago con Cotizacion and Reembolso con Sustento: XML and PDF.
- Petty cash or liquidation: supporting evidence.

For required XML, the server compares supplier identifier, voucher data, date, Net, IGV, and Total when present. XML fiscal totals are authoritative. A mismatch blocks the request and is recorded.

### Step 4 - Review and submit

Check header, supplier, totals, lines, and documents. Select **Submit request** only when complete. Use **Save draft** to continue later. Draft save status is visible, and moving backward does not remove entered data.

From the Requests row menu:

- **Quick view:** opens a side panel without leaving the list.
- **View details:** opens the complete record.
- **Edit:** available to the owner for Draft, Rejected, Returned, or Observed work.
- **Delete/deactivate:** uses a confirmation and only works where backend policy permits.

## 6. Request Detail

The detail page is the complete trace for one expense. It shows:

- Header, requester, supplier, amount, exchange-rate snapshot, and period.
- Workflow stepper and current status.
- Accounting lines and historical dimension snapshots.
- Attachments with protected preview/download.
- XML match result and validation errors.
- Supplier validation and bank history summary.
- Approval events, SLA, comments, IP/sign-off reference.
- Budget commitment/exception.
- Fiscal voucher, CXP, and balanced journals.
- Purchase order where applicable.
- Bank batch, payment confirmation, rendition, reconciliation, and audit timeline.

Buttons appear according to role and status. A disabled control shows why it cannot be used.

## 7. Suppliers and Homologation

Solicitors can propose a supplier. Accounting/Admin completes homologation.

Use **New supplier** or **Edit** to enter identifier type, RUC/DNI, legal name, address, representative, contact, type, currency, and bank data. Duplicate RUC/DNI is blocked. Reused account/CCI produces a warning.

New suppliers start at **PENDING_VALIDATION**. Upload the tax registration, bank certificate, and legal representative ID. Accounting/Admin can choose Homologate, Observe, or Inactivate and must record comments where required.

Editing bank data does not erase the previous account. The old account is closed with a valid-to date and a new active history row is created. Treasury uses the selected valid account snapshot in the payment batch.

## 8. Approvals and SLA

Go to **Approval Inbox**. Search/filter requests and review the amount, supplier, current level, age, due time, and SLA severity.

Available actions are:

- **Approve:** records the authenticated sign-off and sends the request to the next configured level.
- **Observe:** sends the request for clarification/correction; comments are required.
- **Return:** returns the request to the Solicitor; comments are required.
- **Reject:** ends the approval path unless corrected/resubmitted under policy; comments are required.

The system prevents a requester from approving their own request. Admin override requires a written reason and is audited. The sign-off is an internal authenticated approval, not a certified legal digital signature.

## 9. Budget Control

Choose the period and select **Apply**. The summary shows Assigned, Committed, Executed, Paid, and Available from the same transactional budget service used by the workflow.

- **Dimensional budget:** balances by period, Cost Center, expense classification, and project.
- **Budget exceptions:** insufficient-budget cases and their strategy/decision.
- **Budget commitments:** each reservation and independent state/history.
- **Manage allocations:** opens authorized budget master configuration.

In ACTIVE mode the request cannot silently exceed available budget. The rule can reject, request an increase, or request extraordinary approval. Cancelling a committed request before execution releases the reservation once and records the release.

## 10. Accounting and Accounts Payable

Accounting receives only approved, documented, dimensioned requests in an open period.

In **Accounting Entries**:

1. Open the fiscal-processing action.
2. Enter voucher type, series, number, document/accounting date, period, and comments.
3. Review the exact result and confirm.

The backend blocks duplicate supplier + voucher type + series + number. Processing creates one explicit CXP and a balanced provision journal. Debit and credit totals must match.

Use **Accounts Payable** to review original/outstanding amount, voucher, status, provision entry, payment batch, and payment entry.

Use **Accounting Periods** to open, close, or reopen a period with confirmation and comments. A closed period blocks applicable creates, updates, deletes, approvals, accounting, payment, rendition, void, and close actions. Every blocked attempt is audited.

## 11. Treasury

The Treasury page has four controlled areas.

### Payable queue

Filter by bank, currency, date, Cost Center, supplier, or status. Select individual items or **Select all visible rows**. Rows without valid active bank details cannot be selected. The page shows selected count and totals by currency.

### Generate bank file

Review bank, currency, payment date, items, account warnings, count, and total. Confirm only after checking the result statement. The batch is saved with item/account snapshots and checksum.

Current BCP, BBVA, Interbank, and Scotiabank layouts are DEMO / NOT CERTIFIED. Do not send them to a production bank until UMA supplies and certifies the official format.

### Confirm payment

After the bank really executes the payment, select **Confirm payment** and enter operation number, actual date, confirmed amount, and comments. Only this action changes CXP to Paid, creates the payment journal, updates budget, and changes the request to `PAGADO`.

### Reconcile

Match the confirmed payment to the bank statement. Enter bank reference, difference, and comments. A valid result changes the request to `CONCILIADO`; then an authorized close action changes it to `CERRADO`.

## 12. Special Flows

### Entrega a Rendir

The initial accounting uses the configured Account 14 advance/transit mapping, not an expense. After actual payment the request becomes `RENDICION_PENDIENTE`. The Solicitor uploads evidence and declares amount advanced, rendered, returned, and outstanding. Accounting validates the rendition; only then are the real expense/IGV recognized and Account 14 cleared or reduced. Closure is blocked while a required balance/evidence remains.

### Reembolso sin Sustento

The system uses the configured non-deductible mapping and does not post it through the normal deductible expense path.

### Pago con Cotizacion

After required approval, the system can generate an internal purchase order with an immutable `OC-YYYY-XXXXX` reference. XML/PDF evidence remains required according to configuration.

## 13. Reports, SIRE, and Audit

- **Management Reports:** period/date filters, CAPEX/OPEX, budget execution, area/project spend, commitments, CXP, Treasury schedule, and export history according to role.
- **Print request record:** open Request Detail and select **Print record**. Navigation and action controls are removed from the printed financial record.
- **Month-end consolidation:** groups journal data by Cost Center and account. Export is allowed only when source and centralization totals reconcile to zero difference.
- **SIRE/RCE:** shows eligible rows, exclusions, warnings, and CSV history. It prepares a file only; it does not submit directly to SUNAT.
- **Audit Viewer:** Admin/Accounting can search append-only records. Normal application routes cannot update or delete audit events.

## 14. Safety and Daily Use

- Log out when finished and do not share accounts.
- Read the result text in every confirmation dialog.
- Use comments that explain the business decision.
- Never treat a downloaded TXT as proof of payment.
- Do not change historical records to match new master data.
- Back up MongoDB, uploads, and generated files together.
- Contact an administrator when the message contains a structured code such as `ACCOUNTING_PERIOD_CLOSED`, `DUPLICATE_VOUCHER`, or `BANK_DETAILS_MISSING`.

---

# Parte II - Español

## 1. Qué hace el sistema

El sistema controla un gasto institucional desde la primera solicitud hasta el cierre contable. Mantiene conectados la solicitud, el proveedor, los documentos, las aprobaciones, el presupuesto, la contabilidad, la instrucción bancaria, la confirmación real del pago, la conciliación y la auditoría bajo un solo número.

Flujo normal:

`Borrador -> Validación -> Envío -> Director -> Vicerrector -> Presupuesto -> Contabilidad/CXP -> Programación de Tesorería -> TXT bancario -> Confirmación real -> Conciliación -> Cierre`

Generar el TXT bancario no significa que el pago fue realizado. Tesorería debe confirmar la operación después de que el banco la ejecute.

## 2. Ingreso y pantalla principal

Abra la dirección local o HTTPS compartida e ingrese correo y contraseña. Un usuario inactivo no puede ingresar.

- **Navegación izquierda:** muestra solo las páginas permitidas para su rol. La flecha inferior la contrae. En celular, use el ícono de menú.
- **Título y ruta:** indican la página actual.
- **EN/ES:** cambia la interfaz entre inglés y español.
- **Campana:** muestra tareas y notificaciones del rol.
- **Menú de usuario:** muestra nombre, rol, área y Salir.
- **Menú de tres puntos:** abre las acciones de una fila. En celular aparece como una hoja de acciones inferior.

Las tablas permiten Buscar, filtrar, ordenar, cambiar filas por página, avanzar o retroceder, ver resultados y Limpiar filtros. Los cuadros de selección se usan para acciones masivas.

### Navegación rápida y configuración personal de tablas

- Presione **Ctrl/Cmd+K** o `/` fuera de un campo para buscar páginas autorizadas y referencias exactas de solicitud. Use flechas, Inicio/Fin, Enter o Escape.
- Elija densidad **Compacta** o **Cómoda**. La preferencia se aplica a las tablas operativas.
- Use **Guardar vista actual** para conservar en este dispositivo la búsqueda, filtros, orden, densidad y tamaño de página. Recupérela en **Vistas guardadas** o elimínela con el icono adyacente.
- Al volver desde el detalle se conservan búsqueda, filtros, orden, página y tamaño durante la sesión del navegador.
- En tablet/celular, seleccione **Filtros** para desplegarlos. Las acciones de tres puntos aparecen como una hoja inferior con control de foco.

## 3. Roles y acceso

| Rol | Trabajo principal |
|---|---|
| Admin | Usuarios, configuración técnica/maestra, todos los registros y excepciones auditadas. |
| Solicitante | Solicitudes propias, borradores/correcciones, propuestas de proveedor y rendiciones. |
| Aprobador - Director de Área | Solicitudes asignadas al nivel Director. |
| Aprobador - Vicerrector | Solicitudes asignadas al nivel Vicerrector. |
| Contabilidad | Homologación, períodos, validación fiscal, CXP, asientos, tipo de cambio, SIRE y auditoría. |
| Tesorería | Programación, archivos bancarios, confirmación real y conciliación. |
| Presupuesto | Asignaciones, compromisos, excepciones y control presupuestal. |
| Gerencia/Rectorado | Indicadores ejecutivos y aprobaciones extraordinarias configuradas. |

El servidor vuelve a validar el permiso en cada acción. Ocultar o mostrar un botón no es la única protección.

## 4. Dashboard

El Dashboard cambia según el rol: el Solicitante ve borradores, correcciones y rendiciones; el Aprobador ve pendientes, montos y SLA; Contabilidad ve período, cola fiscal, CXP y asientos; Tesorería ve pagos, monedas, datos bancarios, lotes y conciliaciones; Presupuesto ve Asignado, Comprometido, Ejecutado, Pagado y Disponible; Gerencia ve ejecución global y tendencias; Admin ve salud general, usuarios y alertas maestras.

Seleccione una tarea o fila para abrir el trabajo relacionado.

Los paneles muestran **Última actualización** y **Actualizar**. Los gráficos ofrecen valores exactos, acceso a solicitudes filtradas y **Ver datos exactos** como tabla accesible. Reportes Gerenciales incluye filtros de período/fecha, moneda, tipo, área, Centro de Costos y proyecto; comparación anterior; presupuesto; CAPEX/OPEX; tendencias; análisis por área/proyecto/cuenta/proveedor; ciclo y SLA; antigüedad CXP; programación de Tesorería; rendición; conciliación; excepciones y preparación del cierre.

## 5. Crear o corregir una solicitud

Vaya a **Solicitudes** y seleccione **Nueva solicitud**.

### Paso 1 - Información básica

Seleccione tipo, naturaleza del gasto, fecha/período, proveedor, prioridad, moneda y proyecto; escriba una justificación clara. El sistema propone el Centro de Costos del perfil. Otro Centro de Costos solo puede usarse si está autorizado.

Para USD se exige un tipo de cambio exacto de la fecha. PEN siempre usa 1.

### Paso 2 - Líneas contables

Cada línea requiere Centro de Costos, Tipo de Gasto/cuenta, Neto, IGV y Total. El sistema calcula totales y equivalente PEN, y avisa si Neto + IGV no coincide con Total. El backend valida las reglas OPEX, CAPEX y no deducibles.

### Paso 3 - Documentos

La pantalla explica los documentos exigidos. Bienes requiere al menos tres cotizaciones y comprobante; Servicios requiere factura, contrato y conformidad; Pago con Cotización y Reembolso con Sustento requieren XML y PDF; caja chica o rendición requiere sustentos.

Cuando el XML es obligatorio, el servidor compara RUC/DNI, comprobante, fecha, Neto, IGV y Total. Los importes fiscales del XML validado son la fuente autorizada. Una diferencia bloquea y registra el intento.

### Paso 4 - Revisar y enviar

Revise cabecera, proveedor, importes, líneas y archivos. Use **Guardar borrador** para continuar después o **Enviar solicitud** cuando esté completa. Volver a un paso anterior no elimina los datos.

En el menú de tres puntos: **Vista rápida** abre el panel lateral; **Ver detalle** abre el expediente; **Editar** aparece para el propietario en Borrador, Rechazado, Devuelto u Observado; **Eliminar/desactivar** pide confirmación y respeta la regla del backend.

## 6. Detalle de solicitud

Muestra cabecera, solicitante, proveedor, importes, tipo de cambio, período, flujo, líneas, archivos protegidos, validación XML, homologación, aprobaciones/SLA, compromiso, comprobante, CXP, asientos, orden de compra, lote bancario, pago, rendición, conciliación y auditoría. Las acciones dependen del rol y estado; un botón deshabilitado explica la razón.

## 7. Proveedores y homologación

El Solicitante puede proponer; Contabilidad/Admin homologa. Registre tipo y número RUC/DNI, razón social, dirección, representante, contacto, tipo, moneda y banco. RUC/DNI duplicado se bloquea; cuenta/CCI reutilizada genera advertencia.

El proveedor inicia en **PENDING_VALIDATION**. Cargue ficha RUC, certificado bancario e identificación del representante. Contabilidad/Admin puede Homologar, Observar o Inactivar con comentarios.

Cambiar el banco no borra el anterior: se cierra su vigencia y se crea una nueva cuenta activa. Tesorería guarda la cuenta seleccionada dentro del lote de pago.

## 8. Aprobaciones y SLA

En **Bandeja de aprobaciones**, revise monto, proveedor, nivel, antigüedad, vencimiento y severidad SLA.

- **Aprobar:** firma electrónicamente y pasa al siguiente nivel.
- **Observar:** solicita aclaración; exige comentario.
- **Devolver:** retorna al Solicitante; exige comentario.
- **Rechazar:** detiene el flujo según política; exige comentario.

El Solicitante no puede aprobar su propia solicitud. Una excepción de Admin exige motivo y queda auditada. La firma es una aprobación electrónica autenticada interna, no una firma digital legal certificada.

## 9. Control Presupuestal

Seleccione período y **Aplicar**. Los indicadores Asignado, Comprometido, Ejecutado, Pagado y Disponible usan el mismo servicio transaccional del flujo.

Las tablas muestran presupuesto dimensional, excepciones y compromisos. En modo ACTIVE no se permite sobreejecución silenciosa. La regla puede rechazar, solicitar incremento o aprobación extraordinaria. Si se anula antes de ejecutar, la reserva se libera una sola vez y queda auditada.

## 10. Contabilidad y Cuentas por Pagar

Contabilidad recibe solicitudes aprobadas, documentadas, dimensionadas y de período abierto. En **Asientos Contables**, ingrese tipo de comprobante, serie, número, fechas, período y comentario. El backend bloquea duplicados por proveedor + tipo + serie + número.

El procesamiento crea una CXP explícita y un asiento de provisión balanceado. Debe y Haber deben coincidir. En **Cuentas por Pagar** revise saldo, comprobante, estado, provisión, lote y asiento de pago.

En **Períodos Contables**, abrir, cerrar o reabrir exige confirmación. Un período cerrado bloquea las operaciones financieras aplicables en el backend y registra cada intento bloqueado.

## 11. Tesorería

En la cola, filtre y seleccione pagos. Una fila sin cuenta bancaria activa no puede seleccionarse. Revise cantidad y totales por moneda.

Al generar TXT, confirme banco, moneda, fecha, ítems, cuentas y total. El lote conserva snapshots y checksum. Los formatos actuales de BCP, BBVA, Interbank y Scotiabank son **DEMO / NO CERTIFICADOS**.

Después de la ejecución real del banco, use **Confirmar pago** e ingrese número de operación, fecha, importe y comentarios. Solo entonces la CXP queda pagada, se crea el asiento, se actualiza presupuesto y la solicitud pasa a `PAGADO`.

Luego use **Conciliar pago** con referencia bancaria, diferencia y comentario. La solicitud pasa a `CONCILIADO` y después puede cerrarse como `CERRADO`.

## 12. Flujos especiales

- **Entrega a Rendir:** el desembolso inicial usa la cuenta 14 configurada, no gasto. Tras el pago queda `RENDICION_PENDIENTE`. El Solicitante carga evidencia e importes; Contabilidad valida, reconoce el gasto real y limpia o reduce la cuenta 14. No se puede cerrar con saldo o documentos pendientes.
- **Reembolso sin Sustento:** usa la cuenta no deducible configurada.
- **Pago con Cotización:** puede crear una orden interna `OC-YYYY-XXXXX` después de aprobar; mantiene las reglas XML/PDF.

## 13. Reportes, SIRE y auditoría

**Reportes Gerenciales** usa datos transaccionales y filtros. **Consolidación mensual** agrupa por Centro de Costos/cuenta y exige diferencia cero. **SIRE/RCE** prepara y exporta CSV con advertencias e historial; no envía directamente a SUNAT. **Visor de auditoría** es de solo lectura; las rutas normales no modifican ni eliminan eventos.

Para imprimir un expediente, abra Detalle de Solicitud y seleccione **Imprimir expediente**. La versión impresa oculta navegación y controles de acción, pero conserva el registro financiero.

## 14. Uso seguro

- Cierre sesión y no comparta cuentas.
- Lea el resultado exacto en cada confirmación.
- Escriba comentarios que expliquen la decisión.
- Nunca use un TXT descargado como prueba de pago.
- No cambie la historia para reflejar nuevos datos maestros.
- Respalde MongoDB, `uploads` y `generated` juntos.
- Informe al administrador códigos como `ACCOUNTING_PERIOD_CLOSED`, `DUPLICATE_VOUCHER` o `BANK_DETAILS_MISSING`.

## Límites externos / External Limits

SUNAT de producción, envío directo SIRE, formatos bancarios certificados y firma digital legal certificada requieren especificaciones y credenciales reales de UMA y los proveedores. El sistema implementa adaptadores, modo manual/desarrollo y avisos claros; no declara una certificación inexistente.

## Technical Architecture and Backup / Arquitectura Técnica y Respaldo

The browser application is React + Vite. The protected API is Node.js + Express, with MongoDB for business records and local directories for request/supplier uploads, bank files, accounting exports, and reports. JWT, bcrypt, backend RBAC, Helmet, an explicit CORS allow-list, login rate limiting, upload validation, safe generated names, and sanitized errors protect the normal application paths.

A usable backup is a matched snapshot of **both** MongoDB and local storage. Back up `backend/uploads` and `backend/generated` together with the database, keep the files outside the working copy, and test restoration periodically. Run schema/status migrations in dry-run mode first; ambiguous historical records remain in the migration report for manual review.

La aplicación web usa React + Vite. La API protegida usa Node.js + Express, MongoDB conserva los registros y los directorios locales guardan archivos de solicitudes/proveedores, TXT bancarios y exportaciones contables/reportes. JWT, bcrypt, RBAC en backend, Helmet, lista CORS, limitación de intentos, validación de cargas, nombres físicos seguros y errores saneados protegen las rutas normales.

Un respaldo válido debe contener una copia coordinada de **MongoDB y del almacenamiento local**. Respalde `backend/uploads` y `backend/generated` junto con la base de datos, conserve la copia fuera del proyecto y pruebe su restauración. Ejecute primero las migraciones en modo dry-run; los registros históricos ambiguos quedan en el reporte para revisión manual.
