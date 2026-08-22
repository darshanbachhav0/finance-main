# Dataset de Demostración UMA

## Propósito y alcance

Este dataset reemplaza los datos de ejemplo genéricos por una historia financiera coherente para la Universidad María Auxiliadora (UMA). Está destinado exclusivamente al desarrollo, capacitación y demostración del ERP.

Las facultades y el contexto institucional se basan en la información pública de [UMA](https://uma.edu.pe/postula-aqui/): Facultad de Ciencias de la Salud, Facultad de Farmacia y Bioquímica, y Facultad de Ingeniería y Negocios. Todos los nombres de personas, proveedores, RUC/DNI, cuentas, CCI, comprobantes, operaciones bancarias y documentos son ficticios.

Las validaciones SUNAT son manuales/locales en este entorno. La tasa USD/PEN es una tasa manual de demostración y no se presenta como tasa oficial SUNAT. Los archivos TXT de BCP, BBVA, Interbank y Scotiabank son formatos DEMO / NO CERTIFICADOS.

## Accesos principales

Todos los perfiles usan la contraseña de desarrollo `UMA-Demo-2026!`.

| Perfil | Cuenta |
|---|---|
| Administrador | `demo.admin@uma.edu.pe` |
| Solicitante | `demo.solicitante.salud@uma.edu.pe` |
| Director de Área | `demo.director.salud@uma.edu.pe` |
| Vicerrector | `demo.vicerrector@uma.edu.pe` |
| Presupuesto | `demo.presupuesto@uma.edu.pe` |
| Contabilidad | `demo.contabilidad@uma.edu.pe` |
| Tesorería | `demo.tesoreria@uma.edu.pe` |
| Gerencia / Rectorado | `demo.gerencia@uma.edu.pe` |

El seed también crea solicitantes y directores auxiliares de Farmacia e Ingeniería. Estos usuarios dan consistencia a las solicitudes históricas de cada facultad, pero los ocho accesos anteriores son los recomendados para la demostración por rol.

## Datos maestros

- Centros de costo: laboratorios de Salud, Farmacia, Ingeniería e Innovación Digital, Administración y Finanzas, Investigación y Posgrado, y Rectorado.
- Cuentas de gasto: suministros/reactivos, servicios profesionales, mantenimiento, viajes, activos tecnológicos, equipamiento científico y gasto no deducible.
- Proyectos: Campus Digital UMA 2026 e Investigación Biomédica UMA 2026.
- Proveedores: cinco proveedores/beneficiarios homologados con RUC o DNI de formato peruano y un proveedor pendiente de homologación.
- Bancos: cuentas activas BCP, BBVA, Interbank y Scotiabank, más una cuenta BBVA histórica inactiva.
- Periodos: mes actual abierto y mes anterior cerrado.
- Reglas: Director de Área, Vicerrectorado y Rectorado para CAPEX mayor a PEN 100,000; SLA de 24/36 horas.

## Historia del ciclo financiero

| Solicitud | Estado preparado | Demostración principal |
|---|---|---|
| `SOL-2026-30001` | BORRADOR | Borrador incompleto de Ciencias de la Salud |
| `SOL-2026-30002` | PENDIENTE_APROBACION | Bandeja del Director de Área |
| `SOL-2026-30003` | APROBADO_DIRECTOR | Bandeja del Vicerrector |
| `SOL-2026-30004` | APROBADO_VICERRECTOR | CAPEX USD pendiente de Rectorado |
| `SOL-2026-30005` | COMPROMISO_PRESUPUESTAL | Presupuesto reservado y listo para Contabilidad |
| `SOL-2026-30006` | CONTABILIZADO | XML validado, provisión balanceada y CXP abierta |
| `SOL-2026-30007` | PROGRAMADO | Pago programado, sin TXT generado |
| `SOL-2026-30008` | TXT_GENERADO | TXT Scotiabank sin confirmación de pago |
| `SOL-2026-30009` | TXT_GENERADO | CAPEX USD, TXT Interbank y ruta con Rectorado |
| `SOL-2026-30010` | PAGADO | Pago BBVA confirmado, pendiente de conciliación |
| `SOL-2026-30011` | CERRADO | Ciclo completo BCP, conciliado y cerrado |
| `SOL-2026-30012` | RENDICION_PENDIENTE | Entrega a rendir pagada, sustento pendiente |
| `SOL-2026-30013` | CERRADO | Entrega a rendir validada, Cuenta 14 compensada |
| `SOL-2026-30014` | CONTABILIZADO | Reembolso sin sustento en cuenta no deducible |
| `SOL-2026-30015` | OBSERVADO | Corrección solicitada al Solicitante |
| `SOL-2026-30016` | RECHAZADO | Rechazo con comentario obligatorio |
| `SOL-2026-30017` | APROBADO_VICERRECTOR | Excepción por presupuesto insuficiente |
| `SOL-2026-30018` | BORRADOR | Registro histórico en periodo cerrado |

Las solicitudes que avanzan en el flujo fueron procesadas con los servicios reales del backend. Por ello, sus aprobaciones, auditoría, compromisos, órdenes de compra cuando aplican, CXP, asientos, lotes, confirmaciones, rendiciones y conciliaciones permanecen vinculados.

## Reinicio seguro

Desde la raíz del proyecto:

```powershell
npm run backup
npm run seed:reset
npm run seed
npm run verify:data
npm run verify:uma-demo
```

`seed:reset` solo acepta bases cuyo nombre parece de desarrollo, no funciona con `NODE_ENV=production`, y elimina los archivos activos de `backend/uploads` y `backend/generated`. El respaldo se conserva bajo `backend/backups`.

No use estas cuentas, contraseñas, identificadores, documentos ni archivos bancarios en producción.
