import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const DEFAULT_ORIGIN =
  "https://e-consultaruc.sunat.gob.pe";

const DEFAULT_TIMEOUT_MS =
  12_000;

const DEFAULT_CACHE_MINUTES =
  30;

/*
 * SUNAT has historically exposed more than one servlet alias
 * for Consulta RUC.
 *
 * We try both so a minor portal routing change does not
 * immediately break UMA Finance.
 */
const SEARCH_PATHS = [
  "/cl-ti-itmrconsruc/jcrS03Alias",
  "/cl-ti-itmrconsruc/jcrS00Alias"
];

const DETAIL_PATHS = [
  "/cl-ti-itmrconsruc/jcrS00Alias",
  "/cl-ti-itmrconsruc/jcrS03Alias"
];

/*
 * SUNAT's public consultation flow uses a session/random token.
 *
 * This is NOT OCR and does not attempt to solve an image CAPTCHA.
 */
const RANDOM_PATHS = [
  "/cl-ti-itmrconsmulruc/captcha?accion=random",
  "/cl-ti-itmrconsruc/captcha?accion=random"
];

const cache = new Map();
const inflight = new Map();

function env(
  name,
  fallback = ""
) {
  return String(
    process.env[name] ??
      fallback
  ).trim();
}

function positiveNumber(
  value,
  fallback
) {
  const parsed =
    Number(value);

  return (
    Number.isFinite(
      parsed
    ) &&
    parsed > 0
      ? parsed
      : fallback
  );
}

function normalizedRuc(
  value
) {
  return String(
    value ?? ""
  ).replace(
    /\D/g,
    ""
  );
}

function cleanText(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeForCompare(
  value
) {
  return cleanText(
    value
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toUpperCase();
}

/*
 * Small HTML entity decoder.
 *
 * We intentionally avoid adding another npm dependency just
 * for this SUNAT page.
 */
function decodeHtmlEntities(
  value
) {
  const named = {
    nbsp: " ",
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",

    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",

    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",

    ntilde: "ñ",
    Ntilde: "Ñ",

    uuml: "ü",
    Uuml: "Ü"
  };

  return String(
    value ?? ""
  )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (
        match,
        hex
      ) => {
        try {
          return String.fromCodePoint(
            Number.parseInt(
              hex,
              16
            )
          );
        } catch {
          return match;
        }
      }
    )
    .replace(
      /&#(\d+);/g,
      (
        match,
        decimal
      ) => {
        try {
          return String.fromCodePoint(
            Number.parseInt(
              decimal,
              10
            )
          );
        } catch {
          return match;
        }
      }
    )
    .replace(
      /&([a-zA-Z]+);/g,
      (
        match,
        name
      ) =>
        named[name] ??
        match
    );
}

function htmlToText(
  value
) {
  return cleanText(
    decodeHtmlEntities(
      String(
        value ?? ""
      )
        .replace(
          /<br\s*\/?\s*>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
    )
  );
}

/*
 * Convert all HTML table rows into simple arrays.
 *
 * The SUNAT page is server-rendered HTML, so this avoids
 * depending on its CSS classes.
 */
function extractRows(
  html
) {
  const source =
    String(
      html ?? ""
    )
      .replace(
        /<!--[\s\S]*?-->/g,
        ""
      )
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        ""
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        ""
      );

  const rows = [];

  const rowRegex =
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (
      rowMatch =
        rowRegex.exec(
          source
        )
    )
  ) {
    const cells = [];

    const cellRegex =
      /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;

    let cellMatch;

    while (
      (
        cellMatch =
          cellRegex.exec(
            rowMatch[1]
          )
      )
    ) {
      cells.push(
        htmlToText(
          cellMatch[1]
        )
      );
    }

    if (
      cells.length
    ) {
      rows.push(
        cells
      );
    }
  }

  return rows;
}

/*
 * Parse:
 *
 * Documento
 * Nro. Documento
 * Nombre
 * Cargo
 * Fecha Desde
 */
function parseLegalRepresentatives(
  html
) {
  const rows =
    extractRows(
      html
    );

  const headerIndex =
    rows.findIndex(
      (row) => {
        const normalized =
          row.map(
            normalizeForCompare
          );

        return (
          normalized.some(
            (cell) =>
              cell ===
              "DOCUMENTO"
          ) &&
          normalized.some(
            (cell) =>
              cell.includes(
                "NRO"
              ) &&
              cell.includes(
                "DOCUMENTO"
              )
          ) &&
          normalized.some(
            (cell) =>
              cell ===
              "NOMBRE"
          ) &&
          normalized.some(
            (cell) =>
              cell ===
              "CARGO"
          ) &&
          normalized.some(
            (cell) =>
              cell.includes(
                "FECHA"
              ) &&
              cell.includes(
                "DESDE"
              )
          )
        );
      }
    );

  const candidateRows =
    headerIndex >= 0
      ? rows.slice(
          headerIndex + 1
        )
      : rows;

  const representatives =
    [];

  const seen =
    new Set();

  for (
    const row of
    candidateRows
  ) {
    if (
      row.length < 5
    ) {
      continue;
    }

    const [
      documentType,
      documentNumber,
      fullName,
      position,
      dateFrom
    ] = row;

    const normalizedDocumentType =
      normalizeForCompare(
        documentType
      );

    const supportedDocuments =
      [
        "DNI",
        "CE",
        "RUC",
        "PASAPORTE",
        "CARNET DE EXTRANJERIA"
      ];

    if (
      !supportedDocuments.includes(
        normalizedDocumentType
      )
    ) {
      continue;
    }

    if (
      !cleanText(
        documentNumber
      ) ||
      !cleanText(
        fullName
      )
    ) {
      continue;
    }

    const item = {
      documentType:
        cleanText(
          documentType
        ).toUpperCase(),

      documentNumber:
        cleanText(
          documentNumber
        ),

      fullName:
        cleanText(
          fullName
        ),

      position:
        cleanText(
          position
        ),

      dateFrom:
        cleanText(
          dateFrom
        )
    };

    const key = [
      item.documentType,
      item.documentNumber,
      item.fullName,
      item.position,
      item.dateFrom
    ].join("|");

    if (
      !seen.has(
        key
      )
    ) {
      seen.add(
        key
      );

      representatives.push(
        item
      );
    }
  }

  return representatives;
}

function extractCompanyHeading(
  html
) {
  const text =
    htmlToText(
      html
    );

  const match =
    text.match(
      /REPRESENTANTES\s+LEGALES\s+DE\s+(\d{11})\s*-\s*(.+?)(?:RESULTADO\s+DE\s+LA\s+B[ÚU]SQUEDA|La informaci[oó]n exhibida|Documento)/i
    );

  if (
    !match
  ) {
    return {
      ruc: "",
      legalName: ""
    };
  }

  return {
    ruc:
      normalizedRuc(
        match[1]
      ),

    legalName:
      cleanText(
        match[2]
      )
  };
}

function looksLikeSearchResult(
  html,
  ruc
) {
  const normalized =
    normalizeForCompare(
      htmlToText(
        html
      )
    );

  return (
    normalized.includes(
      ruc
    ) &&
    (
      normalized.includes(
        "RESULTADO DE LA BUSQUEDA"
      ) ||
      normalized.includes(
        "NUMERO DE RUC"
      ) ||
      normalized.includes(
        "TIPO CONTRIBUYENTE"
      )
    )
  );
}

function looksLikeRepresentativesResult(
  html,
  ruc
) {
  const normalized =
    normalizeForCompare(
      htmlToText(
        html
      )
    );

  return (
    normalized.includes(
      `REPRESENTANTES LEGALES DE ${ruc}`
    ) ||
    (
      normalized.includes(
        "REPRESENTANTES LEGALES"
      ) &&
      normalized.includes(
        ruc
      )
    )
  );
}

function responseCharset(
  response
) {
  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    );

  const match =
    contentType.match(
      /charset\s*=\s*["']?([^;"'\s]+)/i
    );

  return String(
    match?.[1] ||
      "utf-8"
  ).toLowerCase();
}

async function responseText(
  response
) {
  const bytes =
    new Uint8Array(
      await response.arrayBuffer()
    );

  const charset =
    responseCharset(
      response
    );

  const labels =
    charset.includes(
      "8859-1"
    ) ||
    charset.includes(
      "latin1"
    )
      ? [
          "windows-1252",
          "utf-8"
        ]
      : [
          charset,
          "utf-8",
          "windows-1252"
        ];

  for (
    const label of labels
  ) {
    try {
      return new TextDecoder(
        label,
        {
          fatal: false
        }
      ).decode(
        bytes
      );
    } catch {
      // Try next encoding.
    }
  }

  return Buffer.from(
    bytes
  ).toString(
    "utf8"
  );
}

/*
 * Node fetch does not automatically maintain cookies,
 * so we use a very small cookie jar for this one SUNAT session.
 */
class CookieJar {
  constructor() {
    this.cookies =
      new Map();
  }

  absorb(
    response
  ) {
    let setCookies = [];

    if (
      typeof response
        .headers
        .getSetCookie ===
      "function"
    ) {
      setCookies =
        response
          .headers
          .getSetCookie();
    } else {
      const combined =
        response
          .headers
          .get(
            "set-cookie"
          );

      if (
        combined
      ) {
        setCookies = [
          combined
        ];
      }
    }

    for (
      const line of
      setCookies
    ) {
      const parts =
        String(line).split(
          /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/
        );

      for (
        const part of
        parts
      ) {
        const first =
          part.split(
            ";",
            1
          )[0];

        const separator =
          first.indexOf(
            "="
          );

        if (
          separator <= 0
        ) {
          continue;
        }

        const name =
          first
            .slice(
              0,
              separator
            )
            .trim();

        const value =
          first
            .slice(
              separator + 1
            )
            .trim();

        if (
          name &&
          value
        ) {
          this.cookies.set(
            name,
            value
          );
        }
      }
    }
  }

  header() {
    return [
      ...this.cookies.entries()
    ]
      .map(
        ([
          name,
          value
        ]) =>
          `${name}=${value}`
      )
      .join("; ");
  }
}

function timeoutMs() {
  return positiveNumber(
    env(
      "SUNAT_CONSULTA_RUC_TIMEOUT_MS"
    ),
    DEFAULT_TIMEOUT_MS
  );
}

function portalOrigin() {
  return env(
    "SUNAT_CONSULTA_RUC_ORIGIN",
    DEFAULT_ORIGIN
  ).replace(
    /\/$/,
    ""
  );
}

function buildUrl(
  pathname
) {
  return new URL(
    pathname,
    `${portalOrigin()}/`
  ).toString();
}

function standardHeaders({
  cookie = "",
  referer = ""
} = {}) {
  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/json,text/plain,*/*",

    "Accept-Language":
      "es-PE,es;q=0.9,en;q=0.7",

    "Cache-Control":
      "no-cache",

    Pragma:
      "no-cache",

    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36"
  };

  if (
    cookie
  ) {
    headers.Cookie =
      cookie;
  }

  if (
    referer
  ) {
    headers.Referer =
      referer;
  }

  return headers;
}

async function fetchWithTimeout(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs()
    );

  try {
    return await fetch(
      url,
      {
        ...options,

        signal:
          controller.signal,

        /*
         * Redirects are handled manually so that cookies
         * received during redirects are not lost.
         */
        redirect:
          "manual"
      }
    );
  } finally {
    clearTimeout(
      timer
    );
  }
}

async function requestWithCookies(
  jar,
  url,
  options = {},
  maxRedirects = 5
) {
  let currentUrl =
    url;

  let currentOptions = {
    ...options
  };

  for (
    let index = 0;
    index <=
    maxRedirects;
    index += 1
  ) {
    const cookie =
      jar.header();

    const headers = {
      ...standardHeaders({
        cookie,

        referer:
          currentOptions
            .referer
      }),

      ...(
        currentOptions
          .headers ||
        {}
      )
    };

    delete currentOptions
      .referer;

    const response =
      await fetchWithTimeout(
        currentUrl,
        {
          ...currentOptions,
          headers
        }
      );

    jar.absorb(
      response
    );

    if (
      ![
        301,
        302,
        303,
        307,
        308
      ].includes(
        response.status
      )
    ) {
      return response;
    }

    const location =
      response.headers.get(
        "location"
      );

    if (
      !location
    ) {
      return response;
    }

    currentUrl =
      new URL(
        location,
        currentUrl
      ).toString();

    if (
      [
        301,
        302,
        303
      ].includes(
        response.status
      )
    ) {
      currentOptions = {
        method: "GET",
        headers: {}
      };
    }
  }

  throw new Error(
    "SUNAT Consulta RUC exceeded the redirect limit."
  );
}

async function requestRandomToken(
  jar
) {
  let lastError;

  for (
    const pathname of
    RANDOM_PATHS
  ) {
    for (
      const method of
      [
        "GET",
        "POST"
      ]
    ) {
      try {
        const response =
          await requestWithCookies(
            jar,
            buildUrl(
              pathname
            ),
            {
              method,

              headers:
                method ===
                "POST"
                  ? {
                      "Content-Type":
                        "application/x-www-form-urlencoded;charset=UTF-8"
                    }
                  : {}
            }
          );

        if (
          !response.ok
        ) {
          lastError =
            new Error(
              `HTTP ${response.status}`
            );

          continue;
        }

        const body =
          cleanText(
            await responseText(
              response
            )
          );

        const token =
          body.replace(
            /[^0-9A-Za-z._-]/g,
            ""
          );

        if (
          token &&
          token.length <=
            128 &&
          !/<html/i.test(
            body
          )
        ) {
          return token;
        }
      } catch (
        error
      ) {
        lastError =
          error;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "SUNAT random consultation token was not returned."
    )
  );
}

async function postForm(
  jar,
  pathname,
  form,
  referer
) {
  const body =
    new URLSearchParams(
      form
    ).toString();

  const response =
    await requestWithCookies(
      jar,
      buildUrl(
        pathname
      ),
      {
        method:
          "POST",

        referer,

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8",

          Origin:
            portalOrigin()
        },

        body
      }
    );

  const html =
    await responseText(
      response
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `SUNAT Consulta RUC returned HTTP ${response.status}.`
    );
  }

  return html;
}

/*
 * First open the normal RUC result.
 *
 * This establishes the SUNAT HTTP session required before
 * asking for the representative detail screen.
 */
async function establishRucSession(
  jar,
  ruc
) {
  const landingUrl =
    buildUrl(
      "/cl-ti-itmrconsruc/jcrS00Alias"
    );

  try {
    const landing =
      await requestWithCookies(
        jar,
        landingUrl,
        {
          method: "GET"
        }
      );

    await responseText(
      landing
    );
  } catch {
    /*
     * Some versions establish the session directly from
     * the random-token request, so failure here is not fatal.
     */
  }

  const token =
    await requestRandomToken(
      jar
    );

  let lastHtml = "";
  let lastError;

  for (
    const pathname of
    SEARCH_PATHS
  ) {
    try {
      const html =
        await postForm(
          jar,
          pathname,
          {
            accion:
              "consPorRuc",

            actReturn:
              "1",

            nroRuc:
              ruc,

            numRnd:
              token,

            contexto:
              "ti-it",

            modo:
              "1",

            rbtnTipo:
              "1",

            search1:
              ruc,

            tipdoc:
              "1"
          },
          landingUrl
        );

      lastHtml =
        html;

      if (
        looksLikeSearchResult(
          html,
          ruc
        )
      ) {
        return {
          html,

          referer:
            buildUrl(
              pathname
            )
        };
      }
    } catch (
      error
    ) {
      lastError =
        error;
    }
  }

  if (
    lastHtml
  ) {
    throw new Error(
      "SUNAT returned a page, but it was not a valid RUC result page."
    );
  }

  throw (
    lastError ||
    new Error(
      "SUNAT RUC consultation could not be established."
    )
  );
}

async function fetchRepresentativePage(
  jar,
  ruc,
  legalName,
  referer
) {
  let lastHtml = "";
  let lastError;

  for (
    const pathname of
    DETAIL_PATHS
  ) {
    try {
      const html =
        await postForm(
          jar,
          pathname,
          {
            accion:
              "getRepLeg",

            nroRuc:
              ruc,

            desRuc:
              legalName,

            actReturn:
              "1"
          },
          referer
        );

      lastHtml =
        html;

      if (
        looksLikeRepresentativesResult(
          html,
          ruc
        )
      ) {
        return html;
      }
    } catch (
      error
    ) {
      lastError =
        error;
    }
  }

  if (
    lastHtml
  ) {
    throw new Error(
      "SUNAT returned a page, but the legal-representatives section was not available."
    );
  }

  throw (
    lastError ||
    new Error(
      "SUNAT legal-representative consultation failed."
    )
  );
}

function cacheKey(
  ruc,
  legalName
) {
  return `${ruc}|${normalizeForCompare(
    legalName
  )}`;
}

function cacheTtlMs() {
  return (
    positiveNumber(
      env(
        "SUNAT_CONSULTA_RUC_CACHE_MINUTES"
      ),
      DEFAULT_CACHE_MINUTES
    ) *
    60 *
    1000
  );
}

function readCache(
  key
) {
  const item =
    cache.get(
      key
    );

  if (
    !item
  ) {
    return null;
  }

  if (
    item.expiresAt <=
    Date.now()
  ) {
    cache.delete(
      key
    );

    return null;
  }

  return item.value;
}

function writeCache(
  key,
  value
) {
  cache.set(
    key,
    {
      value,

      expiresAt:
        Date.now() +
        cacheTtlMs()
    }
  );
}

async function lookupInternal(
  ruc,
  legalName
) {
  const jar =
    new CookieJar();

  const session =
    await establishRucSession(
      jar,
      ruc
    );

  const html =
    await fetchRepresentativePage(
      jar,
      ruc,
      legalName,
      session.referer
    );

  const representatives =
    parseLegalRepresentatives(
      html
    );

  const heading =
    extractCompanyHeading(
      html
    );

  return {
    found:
      representatives.length >
      0,

    ruc,

    legalName:
      heading.legalName ||
      cleanText(
        legalName
      ),

    source:
      "SUNAT_CONSULTA_RUC_WEB",

    officialSource:
      true,

    queriedAt:
      new Date()
        .toISOString(),

    representatives,

    message:
      representatives.length
        ? `${representatives.length} legal representative(s) returned by SUNAT Consulta RUC.`
        : "SUNAT Consulta RUC returned no legal representatives for this RUC."
  };
}

export async function lookupSunatLegalRepresentatives(
  rucValue,
  legalNameValue
) {
  const ruc =
    normalizedRuc(
      rucValue
    );

  const legalName =
    cleanText(
      legalNameValue
    );

  if (
    !/^\d{11}$/.test(
      ruc
    )
  ) {
    throw new AppError(
      422,
      "SUNAT legal-representative lookup requires an 11-digit RUC.",
      {
        ruc:
          rucValue
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  if (
    !legalName
  ) {
    throw new AppError(
      422,
      "Legal name is required to retrieve SUNAT legal representatives.",
      {
        ruc
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  const key =
    cacheKey(
      ruc,
      legalName
    );

  const cached =
    readCache(
      key
    );

  if (
    cached
  ) {
    return {
      ...cached,
      cached: true
    };
  }

  /*
   * Prevent five browser requests for the same RUC from making
   * five simultaneous requests to SUNAT.
   */
  if (
    inflight.has(
      key
    )
  ) {
    return inflight.get(
      key
    );
  }

  const promise =
    lookupInternal(
      ruc,
      legalName
    )
      .then(
        (result) => {
          writeCache(
            key,
            result
          );

          return result;
        }
      )
      .catch(
        (error) => {
          const reason =
            error?.name ===
            "AbortError"
              ? "SUNAT Consulta RUC timed out."
              : error?.message ||
                "SUNAT Consulta RUC could not be reached.";

          throw new AppError(
            503,
            "SUNAT legal-representative information is temporarily unavailable.",
            {
              ruc,

              source:
                "SUNAT_CONSULTA_RUC_WEB",

              reason
            },
            ERROR_CODES
              .INTEGRATION_NOT_CONFIGURED
          );
        }
      )
      .finally(
        () => {
          inflight.delete(
            key
          );
        }
      );

  inflight.set(
    key,
    promise
  );

  return promise;
}

/*
 * Exported only so you can unit-test HTML parsing later
 * without making real SUNAT requests.
 */
export const sunatConsultaRucRepresentativeInternals =
  Object.freeze({
    parseLegalRepresentatives,
    extractCompanyHeading,
    decodeHtmlEntities
  });