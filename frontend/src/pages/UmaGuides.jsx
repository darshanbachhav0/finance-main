import PageHeader from '../components/PageHeader.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
const guides=[
 {id:'A1',title:'Purchase with Purchase Order',steps:['Registrar requerimiento, CECO y presupuesto','Adjuntar 3 cotizaciones según la política PDF y sustento CAPEX cuando corresponda','Seguir la ruta de aprobaciones','Registrar OC, comprobante y acta de aceptación','Contabilidad registra CXP; Tesorería programa y GAF valida el lote']},
 {id:'A2',title:'Invoices for an existing PO',steps:['Seleccionar una OC válida','Verificar el saldo de la OC y comprobantes XML/PDF','Contabilidad provisiona importes individualmente','Vincular acta y programar pago con seguimiento de pagos parciales']},
 {id:'B',title:'Direct invoice',steps:['Registrar factura y cuenta de proveedor válidas','Adjuntar evidencia y revisar duplicados','Seguir aprobación y conformidad aplicables','Contabilidad valida y registra, Tesorería programa']},
 {id:'C',title:'Advance / Petty cash',steps:['Validar CECO, finalidad, beneficiario y cuenta','Aprobar el adelanto y registrar pago','Presentar rendición, comprobantes y devolución de saldo dentro del plazo']},
 {id:'D',title:'Transfer between UMA accounts',steps:['Tesorería registra origen, destino y monto','Otro operador de Tesorería y GAF autorizan','Tesorería ejecuta y reconcilia la operación']},
 {id:'M',title:'Mobility',steps:['Indicar trabajador, fecha, trayectos y motivos','Adjuntar hoja firmada','Contabilidad distingue importes deducibles del reparo diario sobre S/ 49.20']},
 {id:'H',title:'Teacher fees',steps:['Gestión de Personas adjunta recibos por honorarios','Registrar constancia de suspensión cuando exista','Aplicar retención del 8% a recibos que exceden S/ 1,500 sin suspensión','Director y GAF revisan antes de cualquier pago']},
 {id:'E',title:'Student refund',steps:['Verificar pago en Motor de Ingresos','Adjuntar evidencia Legal / Libro de Reclamaciones y concepto 704101–704106','Legal y Director evalúan; GAF cuando el importe supera el umbral','Pagos con tarjeta se revierten en pasarela, no por TXT']}
];
export default function UmaGuides(){const {t}=useLanguage();return <section className="uma-module"><PageHeader title="Guides and templates · UMA Payments" description="Steps for each process. M, H and E still require Accounting integration before payment."/>
 <p className="uma-notice">Las condiciones y límites se administran según la configuración de Finanzas; esta guía no sustituye las validaciones vigentes del sistema.</p>
 <div className="uma-grid">{guides.map(g=><article className="uma-panel" key={g.id}><h2>{g.id} · {t(g.title)}</h2><ol>{g.steps.map(x=><li key={x}>{t(x)}</li>)}</ol></article>)}</div></section>}
