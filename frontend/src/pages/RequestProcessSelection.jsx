import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardList, FileText, Landmark, LockKeyhole, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import ContinueWork from '../components/ContinueWork.jsx';
import { UMA_PROCESSES, canStartUmaProcess, processDestination, restrictedProcessLabel } from '../utils/umaProcessSelection.js';
import '../styles/umaProcessSelection.css';

const PROCESS_ICONS = { A1: ClipboardList, A2: FileText, B: FileText, C: Wallet, D: Landmark, M: Wallet, H: FileText, E: Wallet };

/** The mandatory first screen for new requests. No supplier or SUNAT implementation is changed. */
export default function RequestProcessSelection() {
  const { user, readOnly } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Older saved drafts and supplier-registration return URLs must still reopen the full editor.
  if (params.has('workDraft')) return <Navigate to={`/requests/new/form?${params.toString()}`} replace />;

  return <section className="uma-process-page">
    <PageHeader title="New request · Select process" description="Choose a process first. Its form and validations depend on the selected process." />
    <div className="uma-process-intro">
      <div><strong>8 procesos del flujo de pagos UMA</strong><p>Su rol define cuáles puede registrar. Las demás vías se muestran como referencia, sin permitir el acceso.</p></div>
      <CheckCircle2 size={22} aria-hidden="true" />
    </div>
    <div className="uma-process-grid" role="list" aria-label="Procesos de solicitudes UMA">
      {UMA_PROCESSES.map(process => {
        const Icon = PROCESS_ICONS[process.code];
        const allowed = canStartUmaProcess(process, user, readOnly);
        return <div role="listitem" key={process.code} className={`uma-process-card${allowed ? '' : ' is-restricted'}`}>
          <div className="uma-process-card-top"><span className="uma-process-code">{process.code}</span><Icon size={21} aria-hidden="true" /><span className="uma-process-access">{allowed ? 'Disponible' : <><LockKeyhole size={13} aria-hidden="true" /> Restringido</>}</span></div>
          <h3>{t(process.title)}</h3><small>{t(process.subtitle)}</small>
          <p>{t(process.description)}</p>
          <div className="uma-process-documents"><strong>¿Qué necesitará?</strong><span>{process.requirements}</span></div>
          {allowed ? <button className="uma-process-open" type="button" onClick={() => navigate(processDestination(process.code))} aria-label={`Iniciar proceso ${process.code}: ${process.title}`}>Seleccionar {process.code}<ArrowRight size={16} aria-hidden="true" /></button>
            : <div className="uma-process-disabled" aria-label={restrictedProcessLabel(process.code)}><LockKeyhole size={14} aria-hidden="true" />{restrictedProcessLabel(process.code)}</div>}
        </div>;
      })}
    </div>
    <div className="uma-process-bottom"><strong>Validación SUNAT:</strong> Se conserva el flujo actual de verificación de RUC, comprobantes y proveedores, incluido el control de duplicados y las observaciones existentes.</div>
    <ContinueWork scope="request" recordId="new" />
  </section>;
}
