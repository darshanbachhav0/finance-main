// Spanish copy for the operations area. Keys are the English UI strings passed to t().
export default {
  // Session expiry, sign-out and sign-in lockout
  "Your session has expired. Sign in again to continue; your drafts were kept.": "Tu sesión expiró. Inicia sesión nuevamente para continuar; tus borradores se conservaron.",
  "Some changes have not reached your account. Stay signed in to retry. Sign out anyway?": "Algunos cambios aún no llegan a tu cuenta. Permanece conectado para reintentar. ¿Cerrar sesión de todos modos?",
  "Sign out anyway": "Cerrar sesión de todos modos",
  "Stay signed in": "Permanecer conectado",
  "This account is temporarily locked after repeated failed sign-in attempts. Try again later.": "Esta cuenta está bloqueada temporalmente tras varios intentos fallidos de inicio de sesión. Inténtalo más tarde.",
  "Invalid credentials.": "Credenciales inválidas.",
  "Your credentials changed. Sign in again.": "Tus credenciales cambiaron. Inicia sesión nuevamente.",
  "Invalid or expired authentication token.": "El token de autenticación no es válido o expiró.",

  // Dashboard drill-downs
  "View returned requests": "Ver solicitudes devueltas",
  "View pending approvals": "Ver aprobaciones pendientes",
  "View requests awaiting a PO": "Ver solicitudes pendientes de OC",

  // Reports and configuration access
  "Generate a new export to download this report.": "Genera una nueva exportación para descargar este reporte.",
  "A Management Viewer only has access to the management portal; additional permissions cannot be granted.": "Un Visor de Gerencia solo tiene acceso al portal de gerencia; no se le pueden otorgar permisos adicionales.",

  // Dashboard cards and workspace links
  "View pending renditions": "Ver rendiciones pendientes",
  "Keep approved requests moving to a Purchase Order": "Mantén las solicitudes aprobadas avanzando hacia la orden de compra",
  "Review requests awaiting an order, open orders, and invoices registered against them.": "Revisa las solicitudes pendientes de orden, las órdenes abiertas y los comprobantes registrados contra ellas.",
  "Approved requests awaiting a Purchase Order, open orders, and invoices registered against them.": "Solicitudes aprobadas pendientes de orden de compra, órdenes abiertas y comprobantes registrados contra ellas.",
  "Review requests": "Revisar solicitudes",
  "Current accounting period open": "Período contable actual abierto",
  "Current accounting period unavailable": "Período contable actual no disponible",

  // Notification deep links
  "Show all records": "Mostrar todos los registros",
  "The linked record is no longer pending here. It may already have been processed.": "El registro enlazado ya no está pendiente aquí. Es posible que ya se haya procesado.",
  "The linked record is not valid.": "El registro enlazado no es válido.",
  "Showing the request linked from your notification": "Mostrando la solicitud enlazada desde tu notificación",
  "This request is no longer waiting for your approval. Its quick view shows the current status.": "Esta solicitud ya no espera tu aprobación. Su vista rápida muestra el estado actual.",
  "Show all pending approvals": "Mostrar todas las aprobaciones pendientes",
  "Showing the payment linked from your notification": "Mostrando el pago enlazado desde tu notificación",
  "This payment is no longer pending in any Treasury stage. It may already be paid and reconciled.": "Este pago ya no está pendiente en ninguna etapa de Tesorería. Es posible que ya esté pagado y conciliado.",
  "Show all payments": "Mostrar todos los pagos",
  "Showing the budget exceptions of the linked request": "Mostrando las excepciones presupuestales de la solicitud enlazada",
  "No budget exception was found for this link. The request may have been committed or corrected.": "No se encontró una excepción presupuestal para este enlace. Es posible que la solicitud ya se haya comprometido o corregido.",
  "Showing the observed invoice linked from your notification": "Mostrando el comprobante observado enlazado desde tu notificación",
  "Showing the observed invoices of the linked batch": "Mostrando los comprobantes observados del lote enlazado",
  "No open observation remains for this link. The invoices may already have been revalidated.": "No quedan observaciones abiertas para este enlace. Es posible que los comprobantes ya se hayan revalidado.",
  "Show all observations": "Mostrar todas las observaciones",
  "Showing the batch linked from your notification": "Mostrando el lote enlazado desde tu notificación",
  "Showing the batches of the linked request": "Mostrando los lotes de la solicitud enlazada",
  "No invoice batch was found for this link.": "No se encontró un lote de comprobantes para este enlace.",
  "Show all batches": "Mostrar todos los lotes",
  "Showing the CXP linked from your notification": "Mostrando la CXP enlazada desde tu notificación",
  "No CXP was found for this link.": "No se encontró una CXP para este enlace.",
  "Show all CXP": "Mostrar todas las CXP",

  // Accounting mappings configuration
  "Accounting Mappings": "Mapeos contables",
  "Mapping": "Mapeo",
  "Any currency": "Cualquier moneda",
  "Bank code such as BBVA or BCP, or * for any bank.": "Código de banco como BBVA o BCP, o * para cualquier banco.",
  "Accounts payable (CXP)": "Cuentas por pagar (CXP)",
  "Advance in transit": "Anticipo en tránsito",
  "IGV (VAT) credit": "Crédito fiscal IGV",
  "Return receivable": "Cuenta por cobrar por devolución",
  "Exchange gain": "Ganancia por diferencia de cambio",
  "Exchange loss": "Pérdida por diferencia de cambio",
  "GL accounts used by automatic postings that expense types do not cover: accounts payable, bank, advances in transit, IGV, returns, supplier credits and exchange differences. The most specific active mapping for the request type, expense nature, bank and currency wins; * matches any value. Every change is audited.": "Cuentas contables que usan los asientos automáticos no cubiertos por los tipos de gasto: cuentas por pagar, banco, anticipos en tránsito, IGV, devoluciones, créditos de proveedor y diferencias de cambio. Se aplica el mapeo activo más específico por tipo de solicitud, naturaleza del gasto, banco y moneda; * coincide con cualquier valor. Cada cambio se audita."
};
