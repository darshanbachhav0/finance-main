# Alta de proveedores: representante y evidencia SUNAT

## Cambios

- El alta rápida dentro de la solicitud consulta representantes legales en segundo plano después de obtener el RUC. Completa nombre y documento si hay uno; si hay varios, permite elegir. Conserva las correcciones manuales y descarta respuestas de un RUC anterior.
- Tanto el alta rápida como la ficha completa muestran por separado el **estado SUNAT** (ACTIVO, baja u otro valor recibido) y la **condición del domicilio** (HABIDO, NO HABIDO u otro valor recibido).
- Las fechas y la fuente están en una sección desplegable: inscripción, inicio de actividades, baja cuando SUNAT la informa, fecha del padrón si se usó y fecha real de consulta. El representante seleccionado muestra su cargo y la fecha desde la que lo ejerce, cuando están disponibles.
- La ficha guardada conserva evidencia estructurada del contribuyente y de los representantes. Distingue el resultado interno de validación UMA del estado comunicado por SUNAT.
- La extracción reconoce las dos fechas que SUNAT puede colocar en una misma fila. Mantiene las fechas civiles sin desplazamientos y presenta las horas en America/Lima.
- Se admiten DNI, CE, pasaporte y RUC como documento del representante. Se corrigió el ajuste del pie del alta rápida en móvil.

## Base de datos y controles

Se agregaron campos opcionales a `Supplier.taxpayerValidation.sunat` y `Supplier.sunatRepresentatives`. No hay migraciones ni índices nuevos; no se modificaron registros de producción. Los registros existentes mantienen su información y se completan al obtener nueva evidencia.

El servidor consulta la fuente y reutiliza su caché; no acepta estados, fechas o evidencias SUNAT enviados por el navegador. Guarda fuente, RUC, fecha de consulta y auditoría. Los datos extraídos no aprueban automáticamente al proveedor ni sustituyen la revisión contable, los controles de aprobación o la comprobación del comprobante. Se mantienen los permisos departamentales.

## Archivos

| Área | Archivos |
|---|---|
| Extracción y normalización | `backend/src/services/sunatConsultaRucRepresentativesService.js`, `shared/supplierSunat.mjs` |
| Guardado y auditoría | `backend/src/models/Supplier.js`, `backend/src/services/supplierService.js` |
| Alta y ficha | `frontend/src/components/suppliers/SupplierQuickRegister.jsx`, `SupplierForm.jsx`, `SupplierDetail.jsx`, `SupplierSunatEvidence.jsx` |
| Textos y estilos | `frontend/src/context/i18n/supplierSunat.js`, `frontend/src/context/LanguageContext.jsx`, `frontend/src/pages/RequestCreate.jsx`, `frontend/src/styles/supplierForm.css`, `frontend/src/styles/requestWizard.css` |
| Pruebas | `backend/test/supplierAutomaticLookup.test.js`, `backend/test/supplierPhase2.test.js`, `frontend/test/supplierRuc.browser.mjs`, `frontend/test/supplierSunat.browser.mjs`, `frontend/package.json` |

## Validación

- Backend: 35 pruebas aprobadas de extracción, fechas, persistencia, auditoría, propuestas, homologación y restricciones de acceso.
- Frontend: suite de contratos y traducciones aprobada; compilación Vite aprobada.
- Navegador: alta rápida y ficha guardada en escritorio y móvil; representante único/múltiples; conservación de correcciones; cambio de RUC durante la consulta; estado y domicilio independientes; fechas en Lima; envío de nombre y documento.
- Extractor real con páginas SUNAT simuladas: filas con varios pares de fechas, valores en encabezados, caché, consultas concurrentes, recuperación del navegador y manejo de CAPTCHA o cortes de conexión.
- Regresión del flujo minimalista: cuatro indicadores, progreso presupuestal, documentos, facturas, cuatro pasos y calculadora condicional de adelanto aprobados.

## Límites

Solo se muestran datos que la fuente devuelve. El padrón reducido puede servir de respaldo para razón social, estado y domicilio, pero no contiene representantes ni todas las fechas de Consulta RUC. Si SUNAT exige verificación humana o no responde, se informa la indisponibilidad y el registro puede continuar con datos manuales; la revisión financiera sigue pendiente según los controles existentes. La consulta de representantes tiene un tiempo máximo y se ejecuta sin abrir ventanas.

Referencia oficial para la distinción entre estado del RUC y condición de domicilio: [SUNAT — Consultar RUC](https://www.gob.pe/institucion/sunat/pages/565-consultar-el-estado-del-ruc).

Comandos de reproducción: `node --test backend/test/supplierAutomaticLookup.test.js backend/test/supplierPhase2.test.js backend/test/supplierProposalValidation.test.js backend/test/sunatPadronLookup.test.js`, `npm test --workspace frontend`, `npm run build --workspace frontend`, `npm run test:supplier-sunat-ui --workspace frontend`, `npm run test:supplier-ruc-ui --workspace frontend` y `npm run test:minimal-finance-ui --workspace frontend`. Las pruebas de backend usan bases aisladas; las pruebas de navegador usan fixtures HTTP sin escribir datos reales. En equipos con Edge, se puede indicar su ejecutable mediante `PLAYWRIGHT_EXECUTABLE_PATH`.
