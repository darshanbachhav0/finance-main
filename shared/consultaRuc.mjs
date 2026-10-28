export const CONSULTA_RUC_URL = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";

// Also runs in the browser via Playwright.waitForFunction. A form echoing the RUC
// is not a result. Wait for taxpayer evidence or an explicit error instead.
export function consultaRucPageState({ bodyText = document.body?.innerText || "", ruc } = {}) {
  const text = bodyText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase();
  if (/CAPTCHA|NO SOY UN ROBOT|VERIFICACION HUMANA|VERIFIQUE QUE (ES|ERES) HUMANO|VERIFY YOU ARE HUMAN|VERIFYING YOU ARE HUMAN|CHECKING YOUR BROWSER|JUST A MOMENT|VERIFICACION DE SEGURIDAD EN CURSO|INGRESE EL CODIGO/.test(text)) return "CHALLENGE";
  if (/NUMERO DE RUC\s*:\s*\d{11}\s*-/.test(text)) return "PROFILE";
  if (text.includes(ruc) && /CONSULTADO NO ES VALIDO/.test(text)) return "NOT_FOUND";
  if (/SERVICIO NO DISPONIBLE|TEMPORARILY UNAVAILABLE|SERVICE UNAVAILABLE|ACCESS DENIED|ACCESO DENEGADO|REQUEST REJECTED|TOO MANY REQUESTS|SESION (HA )?(EXPIRADO|CADUCADO)/.test(text)) return "UNAVAILABLE";
  return "";
}
