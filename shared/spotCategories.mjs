// SPOT (Sistema de Pago de Obligaciones Tributarias - "detracciones") categories.
// Source: Resolución de Superintendencia N.° 183-2004/SUNAT, Anexos 1, 2 y 3, as amended
// (notably R.S. 071-2018/SUNAT, which set 12% for codes 012/020/022/037 from 2018-04-01), and
// R.S. 073-2006/SUNAT for land freight (code 027). Codes follow SUNAT's catalogue No. 54.
// These are only the seed defaults: the live table is the SpotCategory collection, which
// Finance can adjust (rate, threshold, effective dates) when SUNAT publishes a change.
// The threshold is the operation amount in PEN that must be EXCEEDED for SPOT to apply.
export const SPOT_DEFAULT_EFFECTIVE_FROM = "2018-04-01";

export const SPOT_DEFAULT_CATEGORIES = Object.freeze([
  // Anexo 1 - goods
  { code: "001", annex: "1", description: "Azúcar y melaza de caña", rate: 10, minimumAmount: 700 },
  { code: "003", annex: "1", description: "Alcohol etílico", rate: 10, minimumAmount: 700 },
  // Anexo 2 - goods
  { code: "004", annex: "2", description: "Recursos hidrobiológicos", rate: 4, minimumAmount: 700 },
  { code: "005", annex: "2", description: "Maíz amarillo duro", rate: 4, minimumAmount: 700 },
  { code: "008", annex: "2", description: "Madera", rate: 4, minimumAmount: 700 },
  { code: "009", annex: "2", description: "Arena y piedra", rate: 10, minimumAmount: 700 },
  { code: "010", annex: "2", description: "Residuos, subproductos, desechos, recortes y desperdicios", rate: 15, minimumAmount: 700 },
  { code: "014", annex: "2", description: "Carnes y despojos comestibles", rate: 4, minimumAmount: 700 },
  { code: "016", annex: "2", description: "Aceite de pescado", rate: 10, minimumAmount: 700 },
  { code: "017", annex: "2", description: "Harina, polvo y pellets de pescado y demás invertebrados acuáticos", rate: 4, minimumAmount: 700 },
  { code: "023", annex: "2", description: "Leche", rate: 4, minimumAmount: 700 },
  { code: "031", annex: "2", description: "Oro gravado con el IGV", rate: 10, minimumAmount: 700 },
  { code: "032", annex: "2", description: "Páprika y otros frutos de los géneros capsicum o pimienta", rate: 10, minimumAmount: 700 },
  { code: "034", annex: "2", description: "Minerales metálicos no auríferos", rate: 10, minimumAmount: 700 },
  { code: "035", annex: "2", description: "Bienes exonerados del IGV", rate: 1.5, minimumAmount: 700 },
  { code: "036", annex: "2", description: "Oro y demás minerales metálicos exonerados del IGV", rate: 1.5, minimumAmount: 700 },
  { code: "039", annex: "2", description: "Minerales no metálicos", rate: 10, minimumAmount: 700 },
  { code: "041", annex: "2", description: "Plomo", rate: 15, minimumAmount: 700 },
  // Anexo 3 - services
  { code: "012", annex: "3", description: "Intermediación laboral y tercerización", rate: 12, minimumAmount: 700 },
  { code: "019", annex: "3", description: "Arrendamiento de bienes", rate: 10, minimumAmount: 700 },
  { code: "020", annex: "3", description: "Mantenimiento y reparación de bienes muebles", rate: 12, minimumAmount: 700 },
  { code: "021", annex: "3", description: "Movimiento de carga", rate: 10, minimumAmount: 700 },
  { code: "022", annex: "3", description: "Otros servicios empresariales", rate: 12, minimumAmount: 700 },
  { code: "024", annex: "3", description: "Comisión mercantil", rate: 10, minimumAmount: 700 },
  { code: "025", annex: "3", description: "Fabricación de bienes por encargo", rate: 10, minimumAmount: 700 },
  { code: "026", annex: "3", description: "Servicio de transporte de personas", rate: 10, minimumAmount: 700 },
  { code: "030", annex: "3", description: "Contratos de construcción", rate: 4, minimumAmount: 700 },
  { code: "037", annex: "3", description: "Demás servicios gravados con el IGV", rate: 12, minimumAmount: 700 },
  // Special regimes
  { code: "027", annex: "TRANSPORTE", description: "Servicio de transporte de bienes por vía terrestre", rate: 4, minimumAmount: 400 },
  { code: "040", annex: "INMUEBLES", description: "Primera venta de bienes inmuebles gravada con el IGV", rate: 4, minimumAmount: 700 }
]);

export const SPOT_CATEGORY_OPTIONS = Object.freeze(SPOT_DEFAULT_CATEGORIES.map((item) => ({
  value: item.code,
  label: `${item.code} - ${item.description} (${item.rate}%)`
})));

// SUNAT requires the deposit in whole soles (R.S. 343-2014/SUNAT): round half up.
export function detractionAmountPen(baseAmountPen, rate) {
  return Math.round((Number(baseAmountPen) * Number(rate)) / 100);
}
