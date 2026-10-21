# UMA Finance — mejoras financieras y dashboard del Jefe

Implementación del 21 de octubre de 2026.

## Cambios

- Proveedores: contado, 15, 30, 45, 60 días y plazo personalizado; registro rápido y ficha completa. Se conservan las cuentas de ahorros/corrientes, bancos, monedas y visibilidad por departamento.
- Solicitudes: se conserva el flujo proveedor → comprobante → requerimiento → resumen. Los datos secundarios del comprobante y del resumen quedan desplegables. El botón final dice «Enviar solicitud».
- Adelanto al proveedor: aparece solo con una condición de adelanto. Porcentaje, importe y saldo se actualizan juntos. Los importes introducidos conservan sus céntimos; el servidor valida el adelanto contra el total real. Planificarlo no crea un pago ni un adelanto de empleado del proceso C.
- Crédito: el plazo del proveedor se captura en la solicitud. Las condiciones de la cotización seleccionada y la orden emitida tienen precedencia. El vencimiento usa la emisión y días calendario; los hitos de entrega/conformidad requieren su fecha real. A1 sin condiciones conocidas no inventa un vencimiento a 30 días. B conserva su prioridad, separada de su vencimiento comercial; C conserva su política de pago.
- Jefe: cuatro KPI presupuestales, una barra de ejecución, una tabla de aprobaciones y una alerta de facturas únicamente cuando hay acción pendiente. Se utilizan el libro presupuestal y las aprobaciones del backend. Las pantallas operativas de Administración, Contabilidad, Tesorería y Gerencia se conservan.
- Documentos: un botón abre el drawer existente con factura, archivos del proveedor, sustentos y orden adjunta. La descarga vuelve a comprobar permisos en el servidor. Cerrar el drawer conserva la posición.
- Facturas: lista paginada dentro de Solicitudes, sin un nuevo menú lateral. Estados Pendiente, Por vencer (7 días), Vencida y Pagada; los pagos parciales conservan su saldo.
- Fechas: vencimiento contractual, fecha programada y pago efectivo permanecen separados. La fecha programada proviene de `scheduledFor` o del plan de Tesorería; nunca se deduce del vencimiento. Se muestra en aprobaciones, solicitud, detalle de pago y Tesorería.
- Contabilidad/Administración pueden ajustar el crédito y vencimiento de una factura pendiente desde su detalle, con motivo y auditoría. No se altera el plazo maestro del proveedor, el saldo, la programación de Tesorería ni una instrucción bancaria activa.
- Se corrigió un desbordamiento móvil causado por los radios ocultos de prioridad. Se conservan los tokens visuales de UMA y las traducciones existentes. Los gráficos generales se cargan bajo demanda.

## Base de datos

Cambios aditivos de Mongoose; no se requiere migración ni modificación masiva de registros:

- `Supplier.paymentTerms`: nuevas opciones de crédito y validación de días enteros.
- `FinancialRequest.supplierCreditDaysSnapshot`: plazo maestro capturado.
- `FinancialRequest.supplierPaymentTerms`: condiciones propuestas del proveedor.
- Campos de condiciones compartidos: `plannedAdvanceAmount` opcional, separado de pagos confirmados.
- `AccountsPayable.paymentTermsSnapshot.source`: admite `REQUEST` e `INVOICE_OVERRIDE`.

Se reutilizan los presupuestos, pagos parciales, fechas, historial y auditoría existentes. No se ejecutaron migraciones ni se modificaron datos de producción. Las pruebas usan bases temporales aisladas y las eliminan al terminar.

## Validación

- `npm test`: 662 pruebas de backend aprobadas y suite de frontend aprobada, incluidos los contratos existentes de permisos, traducciones, diseño y procesos A1/A2/B/C.
- Regresión específica final: 37 pruebas aprobadas de crédito, cotizaciones y ciclo financiero.
- `npm run build --workspace frontend`: compilación aprobada. Persiste el aviso de Vite sobre el tamaño de algunos chunks generales.
- `npm run test:minimal-finance-ui --workspace frontend`: aprobado en navegador headless a 1440 px y 390 px. Verifica cuatro KPI, progreso, visibilidad de la fecha programada, descarga, conservación de posición, detalle de factura, cuatro pasos, calculadora condicional, céntimos exactos y payload de envío.

En Windows se puede seleccionar un navegador instalado con `PLAYWRIGHT_EXECUTABLE_PATH`. Las pruebas de backend necesitan MongoDB local en `127.0.0.1:27017`. Las pruebas de navegador usan respuestas controladas; las verificaciones financieras y de permisos ejecutan el backend y MongoDB reales.

## Límites

- Para mostrar presupuesto se necesitan asignaciones del año y departamento; los saldos históricos sin periodo no se presentan como un presupuesto aprobado actual.
- No se interpreta una subida de archivo como entrega o conformidad. Esas condiciones quedan pendientes hasta contar con la fecha acordada.
- Se mantiene la extracción existente de XML/PDF compatibles; no se añadió OCR para documentos escaneados.
- No se verificaron envíos bancarios, correo ni consultas SUNAT de producción.

## Archivos modificados o añadidos

- `backend/src/controllers/dashboardController.js`
- `backend/src/controllers/fileController.js`
- `backend/src/models/AccountsPayable.js`
- `backend/src/models/FinancialRequest.js`
- `backend/src/models/paymentTermFields.js`
- `backend/src/models/Supplier.js`
- `backend/src/routes/accountingRoutes.js`
- `backend/src/routes/dashboardRoutes.js`
- `backend/src/services/approvalService.js`
- `backend/src/services/budgetReportingService.js`
- `backend/src/services/directPaymentService.js`
- `backend/src/services/fileAccessService.js`
- `backend/src/services/invoiceCreditService.js`
- `backend/src/services/jefeDashboardService.js`
- `backend/src/services/payablePaymentTermsService.js`
- `backend/src/services/purchaseOrderService.js`
- `backend/src/services/requestService.js`
- `backend/src/utils/constants.js`
- `backend/test/minimalFinance.test.js`
- `backend/test/run.js`
- `frontend/package.json`
- `frontend/src/App.jsx`
- `frontend/src/components/JefeDashboard.jsx`
- `frontend/src/components/payables/InvoiceCreditEditor.jsx`
- `frontend/src/components/payables/PayableDetail.jsx`
- `frontend/src/components/ProtectedAssetButton.jsx`
- `frontend/src/components/RequestDocumentsDrawer.jsx`
- `frontend/src/components/RequestReview.jsx`
- `frontend/src/components/RequestSummaryFacts.jsx`
- `frontend/src/components/SupplierPaymentCondition.jsx`
- `frontend/src/components/suppliers/CreditDaysField.jsx`
- `frontend/src/components/suppliers/SupplierForm.jsx`
- `frontend/src/components/suppliers/SupplierQuickRegister.jsx`
- `frontend/src/context/i18n/minimalFinance.js`
- `frontend/src/context/LanguageContext.jsx`
- `frontend/src/pages/AccountsPayable.jsx`
- `frontend/src/pages/ApprovalInbox.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/DepartmentInvoices.jsx`
- `frontend/src/pages/RequestCreate.jsx`
- `frontend/src/pages/RequestDetail.jsx`
- `frontend/src/pages/TreasuryQueue.jsx`
- `frontend/src/styles/jefeDashboard.css`
- `frontend/src/styles/requestWizard.css`
- `frontend/test/minimalFinance.browser.mjs`
- `shared/invoiceFinance.mjs`
- `shared/paymentTerms.mjs`
