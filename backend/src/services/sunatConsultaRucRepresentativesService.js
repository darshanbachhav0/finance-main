import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const BACKEND_ROOT =
  path.resolve(
    __dirname,
    "..",
    ".."
  );

const CONSULTA_RUC_URL =
  "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_CACHE_MINUTES =
  30;

const cache =
  new Map();

const inflight =
  new Map();

let browserPromise =
  null;

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
    Number.isFinite(parsed) &&
    parsed > 0
      ? parsed
      : fallback
  );
}

function timeoutMs() {
  return positiveNumber(
    env(
      "SUNAT_CONSULTA_RUC_TIMEOUT_MS"
    ),
    DEFAULT_TIMEOUT_MS
  );
}

function debugEnabled() {
  return [
    "true",
    "1",
    "yes"
  ].includes(
    env(
      "SUNAT_REPRESENTATIVES_DEBUG",
      "false"
    ).toLowerCase()
  );
}

function debugDir() {
  return path.resolve(
    BACKEND_ROOT,
    "debug",
    "sunat-representatives"
  );
}

function normalizeRuc(
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

function normalizeText(
  value
) {
  return cleanText(value)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toUpperCase();
}

function cacheKey(
  ruc,
  legalName
) {
  return `${ruc}|${normalizeText(
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

function getCached(
  key
) {
  const item =
    cache.get(key);

  if (!item) {
    return null;
  }

  if (
    item.expiresAt <=
    Date.now()
  ) {
    cache.delete(key);

    return null;
  }

  return item.data;
}

function saveCached(
  key,
  data
) {
  cache.set(
    key,
    {
      data,

      expiresAt:
        Date.now() +
        cacheTtlMs()
    }
  );
}

async function getBrowser() {
  if (
    browserPromise
  ) {
    return browserPromise;
  }

  const pending =
    chromium
      .launch({
        // Use full Chromium's unified headless mode, not the headless shell.
        // Supplier autofill must never open a desktop window, including when
        // an older launcher still sets SUNAT_REPRESENTATIVES_HEADLESS=false.
        channel: "chromium",
        headless: true
      })
      .then((browser) => {
        browser.once("disconnected", () => {
          // Permit the next lookup to recover if Chromium exits unexpectedly.
          if (browserPromise === pending) browserPromise = null;
        });
        return browser;
      })
      .catch(
        (error) => {
          if (browserPromise === pending) browserPromise = null;

          throw error;
        }
      );

  browserPromise = pending;
  return pending;
}

async function saveDebug(
  page,
  ruc,
  stage
) {
  if (
    !debugEnabled()
  ) {
    return;
  }

  try {
    const dir =
      debugDir();

    await fs.mkdir(
      dir,
      {
        recursive: true
      }
    );

    const safeStage =
      String(stage)
        .replace(
          /[^a-z0-9_-]+/gi,
          "_"
        );

    await page.screenshot({
      path:
        path.join(
          dir,
          `${ruc}-${safeStage}.png`
        ),

      fullPage: true
    });

    await fs.writeFile(
      path.join(
        dir,
        `${ruc}-${safeStage}.html`
      ),
      await page.content(),
      "utf8"
    );
  } catch {
    // Debug generation must never break supplier validation.
  }
}

async function detectHumanChallenge(
  page
) {
  const body =
    normalizeText(
      await page
        .locator("body")
        .innerText()
        .catch(
          () => ""
        )
    );

  const challengeTerms = [
    "CAPTCHA",
    "VERIFICACION",
    "VERIFICACIÓN",
    "NO SOY UN ROBOT",
    "RECAPTCHA",
    "INGRESE EL CODIGO",
    "INGRESE EL CÓDIGO"
  ];

  return challengeTerms.some(
    (term) =>
      body.includes(
        normalizeText(term)
      )
  );
}

async function locateRucInput(
  page
) {
  const selectors = [
    'input[name="search1"]',
    'input[name="nroRuc"]',
    'input[placeholder*="RUC" i]',
    'input[aria-label*="RUC" i]',
    'input[type="text"]'
  ];

  for (
    const selector of
    selectors
  ) {
    const locator =
      page
        .locator(selector)
        .filter({
          visible: true
        })
        .first();

    if (
      await locator
        .count()
        .catch(
          () => 0
        )
    ) {
      if (
        await locator
          .isVisible()
          .catch(
            () => false
          )
      ) {
        return locator;
      }
    }
  }

  return null;
}

async function clickSearchButton(
  page
) {
  const candidates = [
    page.getByRole(
      "button",
      {
        name:
          /^buscar$/i
      }
    ),

    page.locator(
      'input[type="submit"][value*="Buscar" i]'
    ),

    page.locator(
      'input[type="button"][value*="Buscar" i]'
    ),

    page.locator(
      'button:has-text("Buscar")'
    )
  ];

  for (
    const locator of
    candidates
  ) {
    const candidate =
      locator.first();

    if (
      await candidate
        .isVisible()
        .catch(
          () => false
        )
    ) {
      await candidate.click();

      return true;
    }
  }

  return false;
}

async function waitForRucResult(
  page,
  ruc
) {
  await page.waitForFunction(
    (expectedRuc) =>
      document.body
        ?.innerText
        ?.includes(
          expectedRuc
        ),
    ruc,
    {
      timeout:
        timeoutMs()
    }
  );
}

async function findRepresentativesControl(
  page
) {
  const selectors = [
    'a:has-text("Representantes Legales")',

    'button:has-text("Representantes Legales")',

    'input[value*="Representantes Legales" i]',

    '[onclick*="getRepLeg"]',

    'a[href*="getRepLeg"]',

    '[onclick*="RepLeg"]',

    'a:has-text("Rep. Legales")',

    'a:has-text("Rep.Legales")',

    'a:has-text("Representantes")'
  ];

  for (
    const selector of
    selectors
  ) {
    const candidate =
      page
        .locator(selector)
        .first();

    if (
      await candidate
        .isVisible()
        .catch(
          () => false
        )
    ) {
      return candidate;
    }
  }

  /*
   * Last text-based fallback.
   */
  const textLocator =
    page
      .getByText(
        /representantes\s+legales/i
      )
      .first();

  if (
    await textLocator
      .isVisible()
      .catch(
        () => false
      )
  ) {
    return textLocator;
  }

  return null;
}

async function submitRepresentativeFormFallback(
  page,
  ruc,
  legalName
) {
  return page.evaluate(
    ({
      rucValue,
      legalNameValue
    }) => {
      const forms =
        Array.from(
          document.forms || []
        );

      const form =
        forms.find(
          (candidate) =>
            candidate.querySelector(
              '[name="accion"]'
            ) ||
            candidate.action
              ?.includes(
                "jcrS"
              )
        );

      if (!form) {
        return false;
      }

      function assign(
        name,
        value
      ) {
        let element =
          form.querySelector(
            `[name="${name}"]`
          );

        if (!element) {
          element =
            document.createElement(
              "input"
            );

          element.type =
            "hidden";

          element.name =
            name;

          form.appendChild(
            element
          );
        }

        element.value =
          value;
      }

      assign(
        "accion",
        "getRepLeg"
      );

      assign(
        "nroRuc",
        rucValue
      );

      assign(
        "desRuc",
        legalNameValue
      );

      assign(
        "actReturn",
        "1"
      );

      form.submit();

      return true;
    },
    {
      rucValue:
        ruc,

      legalNameValue:
        legalName
    }
  );
}

async function openRepresentatives(
  page,
  ruc,
  legalName
) {
  const control =
    await findRepresentativesControl(
      page
    );

  if (control) {
    /*
     * SUNAT normally navigates in the same page,
     * but support a popup if the implementation changes.
     */
    const popupPromise =
      page
        .waitForEvent(
          "popup",
          {
            timeout:
              2_000
          }
        )
        .catch(
          () => null
        );

    await control.click();

    const popup =
      await popupPromise;

    const target =
      popup || page;

    await target
      .waitForLoadState(
        "domcontentloaded",
        {
          timeout:
            timeoutMs()
        }
      )
      .catch(
        () => {}
      );

    return target;
  }

  /*
   * The SUNAT result page has historically submitted
   * getRepLeg through an existing form.
   *
   * Use that same form from within the real browser session
   * if no visible link can be found.
   */
  const submitted =
    await submitRepresentativeFormFallback(
      page,
      ruc,
      legalName
    ).catch(
      () => false
    );

  if (!submitted) {
    throw new Error(
      "The SUNAT result page did not expose the Legal Representatives option."
    );
  }

  await page
    .waitForLoadState(
      "domcontentloaded",
      {
        timeout:
          timeoutMs()
      }
    )
    .catch(
      () => {}
    );

  return page;
}

async function extractRepresentativeTable(
  page
) {
  const tables =
    await page
      .locator("table")
      .evaluateAll(
        (
          elements
        ) =>
          elements.map(
            (
              table
            ) => {
              const rows =
                Array.from(
                  table.querySelectorAll(
                    "tr"
                  )
                ).map(
                  (
                    row
                  ) =>
                    Array.from(
                      row.querySelectorAll(
                        "th,td"
                      )
                    ).map(
                      (
                        cell
                      ) =>
                        (
                          cell.innerText ||
                          cell.textContent ||
                          ""
                        )
                          .replace(
                            /\u00a0/g,
                            " "
                          )
                          .replace(
                            /\s+/g,
                            " "
                          )
                          .trim()
                    )
                );

              return rows;
            }
          )
      );

  for (
    const rows of
    tables
  ) {
    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {
      continue;
    }

    const headerIndex =
      rows.findIndex(
        (row) => {
          const joined =
            normalizeText(
              row.join(" | ")
            );

          return (
            joined.includes(
              "DOCUMENTO"
            ) &&
            joined.includes(
              "NOMBRE"
            ) &&
            joined.includes(
              "CARGO"
            ) &&
            joined.includes(
              "FECHA"
            )
          );
        }
      );

    if (
      headerIndex < 0
    ) {
      continue;
    }

    const representatives =
      [];

    for (
      const row of
      rows.slice(
        headerIndex + 1
      )
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
      ] =
        row.map(
          cleanText
        );

      if (
        !documentType ||
        !documentNumber ||
        !fullName
      ) {
        continue;
      }

      const normalizedType =
        normalizeText(
          documentType
        );

      if (
        ![
          "DNI",
          "CE",
          "PASAPORTE",
          "RUC",
          "CARNET DE EXTRANJERIA",
          "DOC. NACIONAL DE IDENTIDAD"
        ].some(
          (
            type
          ) =>
            normalizedType.includes(
              normalizeText(
                type
              )
            )
        )
      ) {
        continue;
      }

      representatives.push({
        documentType,
        documentNumber,
        fullName,
        position,
        dateFrom
      });
    }

    if (
      representatives.length
    ) {
      return representatives;
    }
  }

  return [];
}

async function extractHeading(
  page,
  fallbackRuc,
  fallbackLegalName
) {
  const bodyText =
    cleanText(
      await page
        .locator("body")
        .innerText()
        .catch(
          () => ""
        )
    );

  const match =
    bodyText.match(
      /REPRESENTANTES\s+LEGALES\s+DE\s+(\d{11})\s*-\s*(.+?)(?=RESULTADO\s+DE\s+LA\s+B[ÚU]SQUEDA|La información exhibida|Documento)/i
    );

  return {
    ruc:
      match?.[1] ||
      fallbackRuc,

    legalName:
      cleanText(
        match?.[2] ||
        fallbackLegalName
      )
  };
}

async function lookupInternal(
  ruc,
  legalName
) {
  const browser =
    await getBrowser();

  const context =
    await browser.newContext({
      // Identify this public-data client explicitly. SUNAT resets connections
      // using Chromium's default HeadlessChrome user-agent on this host.
      userAgent: "UMA-Finance/1.0 (SUNAT public RUC lookup)",
      locale:
        "es-PE",

      viewport: {
        width:
          1440,

        height:
          1000
      }
    });

  let page;

  try {
    page =
      await context.newPage();

    page.setDefaultTimeout(
      timeoutMs()
    );

    page.setDefaultNavigationTimeout(
      timeoutMs()
    );

    console.log(
      `[SUNAT REPRESENTATIVES] Looking up ${ruc} in the background...`
    );

    const response =
      await page.goto(
        CONSULTA_RUC_URL,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            timeoutMs()
        }
      );

    if (
      !response ||
      !response.ok()
    ) {
      throw new Error(
        `SUNAT Consulta RUC returned HTTP ${
          response?.status() ||
          "unknown"
        }.`
      );
    }

    await saveDebug(
      page,
      ruc,
      "01-home"
    );

    if (
      await detectHumanChallenge(
        page
      )
    ) {
      throw new Error(
        "SUNAT is requesting interactive human verification on Consulta RUC."
      );
    }

    const input =
      await locateRucInput(
        page
      );

    if (!input) {
      throw new Error(
        "The RUC input could not be found on SUNAT Consulta RUC."
      );
    }

    await input.fill(
      ruc
    );

    const clicked =
      await clickSearchButton(
        page
      );

    if (!clicked) {
      await input.press(
        "Enter"
      );
    }

    await waitForRucResult(
      page,
      ruc
    );

    await page
      .waitForLoadState(
        "networkidle",
        {
          timeout:
            5_000
        }
      )
      .catch(
        () => {}
      );

    await saveDebug(
      page,
      ruc,
      "02-ruc-result"
    );

    if (
      await detectHumanChallenge(
        page
      )
    ) {
      throw new Error(
        "SUNAT requested interactive verification after the RUC search."
      );
    }

    console.log(
      `[SUNAT REPRESENTATIVES] RUC result loaded. Retrieving representatives...`
    );

    const representativePage =
      await openRepresentatives(
        page,
        ruc,
        legalName
      );

    await representativePage
      .waitForFunction(
        () =>
          /REPRESENTANTES\s+LEGALES/i.test(
            document.body
              ?.innerText ||
            ""
          ),
        undefined,
        {
          timeout:
            timeoutMs()
        }
      )
      .catch(
        () => {}
      );

    await saveDebug(
      representativePage,
      ruc,
      "03-representatives"
    );

    if (
      await detectHumanChallenge(
        representativePage
      )
    ) {
      throw new Error(
        "SUNAT requested interactive human verification before displaying legal representatives."
      );
    }

    const representatives =
      await extractRepresentativeTable(
        representativePage
      );

    const heading =
      await extractHeading(
        representativePage,
        ruc,
        legalName
      );

    console.log(
      `[SUNAT REPRESENTATIVES] Found ${representatives.length} representative(s) for ${ruc}.`
    );

    return {
      found:
        representatives.length >
        0,

      ruc:
        heading.ruc,

      legalName:
        heading.legalName,

      source:
        "SUNAT_CONSULTA_RUC_BROWSER",

      officialSource:
        true,

      automation:
        "PLAYWRIGHT",

      queriedAt:
        new Date()
          .toISOString(),

      representatives,

      message:
        representatives.length
          ? `${representatives.length} legal representative(s) returned by SUNAT Consulta RUC.`
          : "SUNAT Consulta RUC loaded correctly but did not return legal representatives."
    };
  } finally {
    await context.close();
  }
}

export async function lookupSunatLegalRepresentatives(
  rucValue,
  legalNameValue
) {
  const ruc =
    normalizeRuc(
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
      "SUNAT representative lookup requires an 11-digit RUC.",
      {
        ruc:
          rucValue
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  if (!legalName) {
    throw new AppError(
      422,
      "Legal name is required for the SUNAT representative lookup.",
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
    getCached(
      key
    );

  if (cached) {
    return {
      ...cached,

      cached:
        true
    };
  }

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
        (
          result
        ) => {
          saveCached(
            key,
            result
          );

          return result;
        }
      )
      .catch(
        (
          error
        ) => {
          console.error(
            `[SUNAT REPRESENTATIVES] ${ruc}:`,
            error
          );

          let message =
            error?.message ||
            "SUNAT Consulta RUC could not be completed.";

          if (
            /executable.*doesn.?t exist|browser.*not found/i.test(
              message
            )
          ) {
            message =
              "Playwright Chromium is not installed. Run: npx playwright install chromium";
          }

          if (
            /human verification|captcha|recaptcha/i.test(
              message
            )
          ) {
            message =
              "SUNAT Consulta RUC is currently requiring manual browser verification. Automated representative lookup cannot continue until SUNAT allows the normal public browser flow.";
          }

          throw new AppError(
            503,
            message,
            {
              ruc,

              source:
                "SUNAT_CONSULTA_RUC_BROWSER",

              originalError:
                error?.message,

              debugDirectory:
                debugEnabled()
                  ? debugDir()
                  : undefined
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

export async function closeSunatRepresentativesBrowser() {
  if (
    !browserPromise
  ) {
    return;
  }

  const browser =
    await browserPromise.catch(
      () => null
    );

  browserPromise =
    null;

  await browser
    ?.close()
    .catch(
      () => {}
    );
}
