import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileCheck2,
  Landmark,
  RefreshCw,
  Save,
  ShieldCheck,
  Truck,
  UserCheck,
  Users
} from "lucide-react";

import {
  useEffect,
  useState
} from "react";

import {
  useLanguage
} from "../../context/LanguageContext.jsx";

const emptyContact = {
  name: "",
  position: "",
  phone: "",
  email: ""
};

function normalizeRepresentativeDocumentType(
  value
) {
  const normalized =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  if (
    normalized ===
    "DNI"
  ) {
    return "DNI";
  }

  if (
    normalized ===
      "CE" ||
    normalized.includes(
      "EXTRANJER"
    )
  ) {
    return "CE";
  }

  return normalized ||
    "DNI";
}

function initialValues(
  supplier,
  identifier,
  padronLookup
) {
  const padron =
    padronLookup?.found
      ? padronLookup.data
      : null;

  return {
    rucDni:
      supplier?.rucDni ||
      padron?.rucDni ||
      identifier ||
      "",

    legalName:
      supplier?.legalName ||
      supplier?.name ||
      padron?.legalName ||
      "",

    commercialName:
      supplier?.commercialName ||
      padron?.commercialName ||
      "",

    personType:
      supplier?.personType ||
      padron?.personType ||
      "",

    fiscalAddress:
      supplier?.fiscalAddress ||
      supplier?.taxAddress ||
      padron?.fiscalAddress ||
      "",

    district:
      supplier?.location
        ?.district ||
      padron?.location
        ?.district ||
      "",

    province:
      supplier?.location
        ?.province ||
      padron?.location
        ?.province ||
      "",

    department:
      supplier?.location
        ?.department ||
      padron?.location
        ?.department ||
      "",

    ubigeo:
      supplier?.location
        ?.ubigeo ||
      padron?.location
        ?.ubigeo ||
      "",

    website:
      supplier?.website ||
      "",

    legalRepresentative:
      supplier
        ?.legalRepresentative ||
      "",

    representativeDocumentType:
      supplier
        ?.legalRepresentativeDocument
        ?.type ||
      "DNI",

    representativeDocumentNumber:
      supplier
        ?.legalRepresentativeDocument
        ?.number ||
      "",

    commercialContact: {
      ...emptyContact,

      ...(
        supplier
          ?.commercialContact ||
        {}
      )
    },

    operationsContact: {
      ...emptyContact,

      ...(
        supplier
          ?.operationsContact ||
        {}
      )
    },

    currency:
      supplier?.currency ||
      "PEN",

    paymentTermOption:
      supplier
        ?.paymentTerms
        ?.option ||
      "CREDIT_30",

    paymentTermDays:
      supplier
        ?.paymentTerms
        ?.days ||
      30,

    paymentTermComments:
      supplier
        ?.paymentTerms
        ?.comments ||
      "",

    goodsServicesProfile:
      supplier
        ?.goodsServicesProfile ||
      "",

    deliveryMethod:
      supplier
        ?.delivery
        ?.method ||
      "CENTRAL_WAREHOUSE",

    deliveryOther:
      supplier
        ?.delivery
        ?.other ||
      "",

    proposalJustification:
      supplier
        ?.proposalJustification ||
      "",

    stateSanctionsAnswer:
      supplier
        ?.declarations
        ?.stateSanctions
        ?.answer ||
      "NOT_DECLARED",

    stateSanctionsComments:
      supplier
        ?.declarations
        ?.stateSanctions
        ?.comments ||
      "",

    complianceModelAnswer:
      supplier
        ?.declarations
        ?.complianceModel
        ?.answer ||
      "NOT_DECLARED",

    complianceModelComments:
      supplier
        ?.declarations
        ?.complianceModel
        ?.comments ||
      "",

    bank:
      "",

    accountType:
      "CURRENT",

    accountNumber:
      "",

    cci:
      "",

    accountCurrency:
      supplier?.currency ||
      "PEN",

    accountHolderName:
      supplier?.legalName ||
      supplier?.name ||
      padron
        ?.accountHolderName ||
      padron
        ?.legalName ||
      ""
  };
}

function Section({
  icon: Icon,
  title,
  status,
  children
}) {
  const {
    t
  } =
    useLanguage();

  return (
    <section className="supplier-form-section">
      <header>
        <span className="section-icon">
          <Icon
            size={17}
            aria-hidden="true"
          />
        </span>

        <div>
          <h3>
            {t(title)}
          </h3>

          {
            status && (
              <small>
                {t(status)}
              </small>
            )
          }
        </div>
      </header>

      {children}
    </section>
  );
}

function ContactFields({
  legend,
  value,
  onChange
}) {
  const {
    t
  } =
    useLanguage();

  return (
    <fieldset className="form-grid supplier-contact-fields">
      <legend className="sr-only">
        {t(legend)}
      </legend>

      <label className="field">
        <span>
          {t(
            "Contact name"
          )}
        </span>

        <input
          value={
            value.name
          }
          onChange={
            (event) =>
              onChange(
                "name",
                event
                  .target
                  .value
              )
          }
        />
      </label>

      <label className="field">
        <span>
          {t(
            "Position"
          )}
        </span>

        <input
          value={
            value.position
          }
          onChange={
            (event) =>
              onChange(
                "position",
                event
                  .target
                  .value
              )
          }
        />
      </label>

      <label className="field">
        <span>
          {t(
            "Mobile phone"
          )}
        </span>

        <input
          value={
            value.phone
          }
          onChange={
            (event) =>
              onChange(
                "phone",
                event
                  .target
                  .value
              )
          }
          inputMode="tel"
        />
      </label>

      <label className="field">
        <span>
          {t(
            "Email"
          )}
        </span>

        <input
          type="email"
          value={
            value.email
          }
          onChange={
            (event) =>
              onChange(
                "email",
                event
                  .target
                  .value
              )
          }
        />
      </label>
    </fieldset>
  );
}

export default function SupplierForm({
  supplier,
  identifier,
  padronLookup = null,
  representativeLookup = null,
  includeInitialBank = false,
  loading = false,
  onSubmit,
  onCancel
}) {
  const {
    t
  } =
    useLanguage();

  const [
    form,
    setForm
  ] =
    useState(
      () =>
        initialValues(
          supplier,
          identifier,
          padronLookup
        )
    );

  const [
    files,
    setFiles
  ] =
    useState({});

  const [
    error,
    setError
  ] =
    useState("");

  const padronData =
    padronLookup?.found
      ? padronLookup.data
      : null;

  const legalRepresentatives =
    representativeLookup
      ?.data
      ?.representatives ||
    [];

  /*
   * When SUNAT reports exactly one legal representative,
   * automatically fill the existing legal-representative fields.
   *
   * When there is more than one representative we do NOT guess
   * which person UMA should treat as primary. The user chooses.
   */
  useEffect(
    () => {
      if (
        supplier ||
        legalRepresentatives.length !==
          1
      ) {
        return;
      }

      const representative =
        legalRepresentatives[0];

      setForm(
        (current) => {
          if (
            current
              .legalRepresentative ||
            current
              .representativeDocumentNumber
          ) {
            return current;
          }

          return {
            ...current,

            legalRepresentative:
              representative.fullName ||
              "",

            representativeDocumentType:
              normalizeRepresentativeDocumentType(
                representative.documentType
              ),

            representativeDocumentNumber:
              representative.documentNumber ||
              ""
          };
        }
      );
    },
    [
      supplier,
      representativeLookup
        ?.data
        ?.queriedAt
    ]
  );

  function setValue(
    field,
    value
  ) {
    setForm(
      (current) => ({
        ...current,

        [field]:
          value
      })
    );
  }

  function setContact(
    group,
    field,
    value
  ) {
    setForm(
      (current) => ({
        ...current,

        [group]: {
          ...current[
            group
          ],

          [field]:
            value
        }
      })
    );
  }

  function useLegalRepresentative(
    representative
  ) {
    setForm(
      (current) => ({
        ...current,

        legalRepresentative:
          representative.fullName ||
          "",

        representativeDocumentType:
          normalizeRepresentativeDocumentType(
            representative.documentType
          ),

        representativeDocumentNumber:
          representative.documentNumber ||
          ""
      })
    );
  }

  async function submit(
    event
  ) {
    event.preventDefault();

    if (
      !/^\d{8}$|^\d{11}$/.test(
        form.rucDni.replace(
          /\D/g,
          ""
        )
      )
    ) {
      setError(
        t(
          "Enter a valid 11-digit RUC or supported 8-digit DNI."
        )
      );

      return;
    }

    if (
      !form.legalName.trim() ||
      !form
        .proposalJustification
        .trim()
    ) {
      setError(
        t(
          "Legal name and registration justification are required."
        )
      );

      return;
    }

    if (
      form
        .paymentTermOption ===
        "CUSTOM" &&
      !(
        Number(
          form
            .paymentTermDays
        ) > 0
      )
    ) {
      setError(
        t(
          "Custom payment terms require a positive number of days."
        )
      );

      return;
    }

    if (
      form
        .deliveryMethod ===
        "OTHER" &&
      !form
        .deliveryOther
        .trim()
    ) {
      setError(
        t(
          "Explain the other delivery method."
        )
      );

      return;
    }

    const payload =
      new FormData();

    for (
      const field of [
        "rucDni",
        "legalName",
        "commercialName",
        "personType",
        "fiscalAddress",
        "website",
        "legalRepresentative",
        "currency",
        "goodsServicesProfile",
        "proposalJustification"
      ]
    ) {
      payload.append(
        field,
        form[field]
      );
    }

    payload.append(
      "name",
      form.legalName
    );

    payload.append(
      "location",
      JSON.stringify({
        district:
          form.district,

        province:
          form.province,

        department:
          form.department,

        ubigeo:
          form.ubigeo
      })
    );

    payload.append(
      "legalRepresentativeDocument",
      JSON.stringify({
        type:
          form
            .representativeDocumentType,

        number:
          form
            .representativeDocumentNumber
      })
    );

    payload.append(
      "commercialContact",
      JSON.stringify(
        form
          .commercialContact
      )
    );

    payload.append(
      "operationsContact",
      JSON.stringify(
        form
          .operationsContact
      )
    );

    payload.append(
      "paymentTerms",
      JSON.stringify({
        option:
          form
            .paymentTermOption,

        days:
          Number(
            form
              .paymentTermDays
          ),

        comments:
          form
            .paymentTermComments
      })
    );

    payload.append(
      "delivery",
      JSON.stringify({
        method:
          form
            .deliveryMethod,

        other:
          form
            .deliveryOther
      })
    );

    payload.append(
      "declarations",
      JSON.stringify({
        stateSanctions: {
          answer:
            form
              .stateSanctionsAnswer,

          comments:
            form
              .stateSanctionsComments
        },

        complianceModel: {
          answer:
            form
              .complianceModelAnswer,

          comments:
            form
              .complianceModelComments
        }
      })
    );

    if (
      includeInitialBank &&
      form.bank
    ) {
      for (
        const [
          key,
          value
        ] of Object.entries({
          bankName:
            form.bank,

          accountType:
            form.accountType,

          bankAccount:
            form.accountNumber,

          cci:
            form.cci,

          accountHolderName:
            form
              .accountHolderName,

          currency:
            form
              .accountCurrency
        })
      ) {
        payload.append(
          key,
          value
        );
      }
    }

    for (
      const [
        field,
        file
      ] of Object.entries(
        files
      )
    ) {
      if (
        file
      ) {
        payload.append(
          field,
          file
        );
      }
    }

    setError("");

    await onSubmit(
      payload
    );
  }

  const documentKinds =
    new Set(
      (
        supplier?.documents ||
        []
      ).map(
        (item) =>
          item.kind
      )
    );

  return (
    <form
      className="supplier-official-form"
      onSubmit={
        submit
      }
      noValidate
    >
      {
        error && (
          <div
            className="inline-alert alert-error"
            role="alert"
          >
            {error}
          </div>
        )
      }

      {
        !supplier &&
        padronLookup
          ?.found && (
          <div
            className={`inline-alert ${
              padronData
                ?.eligibleForHomologation
                ? "alert-success"
                : "alert-warning"
            }`}
            role="status"
          >
            {
              padronData
                ?.eligibleForHomologation
                ? (
                  <CheckCircle2
                    size={
                      18
                    }
                    aria-hidden="true"
                  />
                )
                : (
                  <AlertTriangle
                    size={
                      18
                    }
                    aria-hidden="true"
                  />
                )
            }

            <div>
              <strong>
                {t(
                  "SUNAT Padrón data loaded automatically"
                )}
              </strong>

              <span>
                {
                  padronData
                    ?.legalName ||
                  form
                    .legalName
                }

                {" · "}

                {t(
                  "Status"
                )}:
                {" "}
                {
                  padronData
                    ?.taxpayerStatus ||
                  "-"
                }

                {" · "}

                {t(
                  "Domicile condition"
                )}:
                {" "}
                {
                  padronData
                    ?.domicileCondition ||
                  "-"
                }

                {
                  padronData
                    ?.location
                    ?.ubigeo
                    ? ` · UBIGEO: ${padronData.location.ubigeo}`
                    : ""
                }

                {
                  padronLookup
                    ?.datasetDate
                    ? ` · Dataset: ${padronLookup.datasetDate}`
                    : ""
                }
              </span>
            </div>
          </div>
        )
      }

      {
        !supplier &&
        padronLookup &&
        !padronLookup
          .found && (
          <div
            className="inline-alert alert-warning"
            role="status"
          >
            <AlertTriangle
              size={18}
              aria-hidden="true"
            />

            <div>
              <strong>
                {t(
                  "RUC not found in the current SUNAT Padrón"
                )}
              </strong>

              <span>
                {
                  padronLookup
                    .message ||
                  t(
                    "You can continue entering the proposal manually, but SUNAT validation will still be required before homologation."
                  )
                }
              </span>
            </div>
          </div>
        )
      }

      {
        !supplier &&
        representativeLookup
          ?.loading && (
          <div className="inline-alert alert-info">
            <RefreshCw
              size={18}
              className="spin"
              aria-hidden="true"
            />

            <div>
              <strong>
                {t(
                  "Checking SUNAT legal representatives..."
                )}
              </strong>

              <span>
                {t(
                  "The supplier form is already available while Consulta RUC is checked in the background."
                )}
              </span>
            </div>
          </div>
        )
      }

      {
        !supplier &&
        representativeLookup
          ?.error && (
          <div
            className="inline-alert alert-warning"
            role="status"
          >
            <AlertTriangle
              size={18}
              aria-hidden="true"
            />

            <div>
              <strong>
                {t(
                  "SUNAT representative lookup temporarily unavailable"
                )}
              </strong>

              <span>
                {
                  representativeLookup
                    .error
                }

                {" "}

                {t(
                  "The Padrón validation above remains valid and supplier creation can continue."
                )}
              </span>
            </div>
          </div>
        )
      }

      {
        !supplier &&
        representativeLookup
          ?.data && (
          <Section
            icon={
              UserCheck
            }
            title="SUNAT Legal Representatives"
            status="Consulta RUC · Additional public validation"
          >
            <div className="inline-alert alert-info">
              <ShieldCheck
                size={18}
                aria-hidden="true"
              />

              <div>
                <strong>
                  REPRESENTANTES LEGALES DE{" "}
                  {
                    representativeLookup
                      .data
                      .ruc
                  }
                  {" - "}
                  {
                    representativeLookup
                      .data
                      .legalName ||
                    form
                      .legalName
                  }
                </strong>

                <span>
                  La información exhibida en esta consulta corresponde a lo declarado por el contribuyente ante la Administración Tributaria.
                </span>
              </div>
            </div>

            {
              legalRepresentatives.length >
              0
                ? (
                  <div className="detail-stack">
                    {
                      legalRepresentatives.map(
                        (
                          representative,
                          index
                        ) => (
                          <div
                            className="detail-section"
                            key={
                              `${representative.documentType}-${representative.documentNumber}-${index}`
                            }
                          >
                            <dl className="supplier-detail-grid">
                              <div>
                                <dt>
                                  {t(
                                    "Document"
                                  )}
                                </dt>

                                <dd>
                                  {
                                    representative.documentType ||
                                    "-"
                                  }
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  {t(
                                    "Document number"
                                  )}
                                </dt>

                                <dd>
                                  {
                                    representative.documentNumber ||
                                    "-"
                                  }
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  {t(
                                    "Name"
                                  )}
                                </dt>

                                <dd>
                                  <strong>
                                    {
                                      representative.fullName ||
                                      "-"
                                    }
                                  </strong>
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  {t(
                                    "Position"
                                  )}
                                </dt>

                                <dd>
                                  {
                                    representative.position ||
                                    "-"
                                  }
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  {t(
                                    "Effective From"
                                  )}
                                </dt>

                                <dd>
                                  {
                                    representative.dateFrom ||
                                    "-"
                                  }
                                </dd>
                              </div>
                            </dl>

                            <div className="supplier-form-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={
                                  () =>
                                    useLegalRepresentative(
                                      representative
                                    )
                                }
                              >
                                <UserCheck
                                  size={
                                    16
                                  }
                                />

                                <span>
                                  {t(
                                    "Use as legal representative"
                                  )}
                                </span>
                              </button>
                            </div>
                          </div>
                        )
                      )
                    }

                    {
                      legalRepresentatives.length ===
                        1 && (
                        <div className="inline-alert alert-success">
                          <CheckCircle2
                            size={18}
                          />

                          <span>
                            {t(
                              "The single SUNAT representative was automatically copied into the Legal Representative fields below."
                            )}
                          </span>
                        </div>
                      )
                    }

                    {
                      legalRepresentatives.length >
                        1 && (
                        <div className="inline-alert alert-info">
                          <Users
                            size={18}
                          />

                          <span>
                            {t(
                              "SUNAT reports multiple representatives. Select the person UMA wants to record as the primary representative; the system will not guess automatically."
                            )}
                          </span>
                        </div>
                      )
                    }
                  </div>
                )
                : (
                  <div className="inline-alert alert-warning">
                    <AlertTriangle
                      size={18}
                    />

                    <span>
                      {t(
                        "SUNAT Consulta RUC did not return legal representatives for this RUC."
                      )}
                    </span>
                  </div>
                )
            }

            <p className="section-note">
              {t(
                "Source: SUNAT Consulta RUC public portal. This is additional validation and does not replace the supplier's supporting legal documentation."
              )}
            </p>
          </Section>
        )
      }

      <Section
        icon={Building2}
        title="Legal Identification"
        status="RCO-FOR-002 · Section 1"
      >
        <div className="form-grid supplier-form-grid">
          <label className="field">
            <span>
              {t(
                "RUC / identifier"
              )} *
            </span>

            <input
              value={
                form.rucDni
              }
              onChange={
                (event) =>
                  setValue(
                    "rucDni",
                    event
                      .target
                      .value
                  )
              }
              inputMode="numeric"
              readOnly={
                !supplier &&
                Boolean(
                  identifier
                )
              }
              required
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Person Type"
              )}
            </span>

            <select
              value={
                form.personType
              }
              onChange={
                (event) =>
                  setValue(
                    "personType",
                    event
                      .target
                      .value
                  )
              }
            >
              <option value="">
                {t(
                  "Select"
                )}
              </option>

              <option value="LEGAL_ENTITY">
                {t(
                  "LEGAL_ENTITY"
                )}
              </option>

              <option value="NATURAL_PERSON_WITH_BUSINESS">
                {t(
                  "NATURAL_PERSON_WITH_BUSINESS"
                )}
              </option>
            </select>
          </label>

          <label className="field field-span-2">
            <span>
              {t(
                "Legal Name"
              )} *
            </span>

            <input
              value={
                form
                  .legalName
              }
              onChange={
                (event) =>
                  setValue(
                    "legalName",
                    event
                      .target
                      .value
                  )
              }
              required
            />
          </label>

          <label className="field field-span-2">
            <span>
              {t(
                "Commercial Name"
              )}
            </span>

            <input
              value={
                form
                  .commercialName
              }
              onChange={
                (event) =>
                  setValue(
                    "commercialName",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field field-span-2">
            <span>
              {t(
                "Fiscal Address"
              )}
            </span>

            <input
              value={
                form
                  .fiscalAddress
              }
              onChange={
                (event) =>
                  setValue(
                    "fiscalAddress",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              {t(
                "District"
              )}
            </span>

            <input
              value={
                form.district
              }
              onChange={
                (event) =>
                  setValue(
                    "district",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Province"
              )}
            </span>

            <input
              value={
                form
                  .province
              }
              onChange={
                (event) =>
                  setValue(
                    "province",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Department"
              )}
            </span>

            <input
              value={
                form
                  .department
              }
              onChange={
                (event) =>
                  setValue(
                    "department",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              UBIGEO SUNAT
            </span>

            <input
              value={
                form.ubigeo
              }
              onChange={
                (event) =>
                  setValue(
                    "ubigeo",
                    event
                      .target
                      .value
                  )
              }
              inputMode="numeric"
              maxLength="6"
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Website"
              )}
            </span>

            <input
              type="url"
              value={
                form.website
              }
              onChange={
                (event) =>
                  setValue(
                    "website",
                    event
                      .target
                      .value
                  )
              }
              placeholder="https://"
            />
          </label>

          <label className="field field-span-2">
            <span>
              {t(
                "Legal Representative"
              )}
            </span>

            <input
              value={
                form
                  .legalRepresentative
              }
              onChange={
                (event) =>
                  setValue(
                    "legalRepresentative",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Representative document type"
              )}
            </span>

            <select
              value={
                form
                  .representativeDocumentType
              }
              onChange={
                (event) =>
                  setValue(
                    "representativeDocumentType",
                    event
                      .target
                      .value
                  )
              }
            >
              <option value="DNI">
                DNI
              </option>

              <option value="CE">
                CE
              </option>

              <option value="PASAPORTE">
                PASAPORTE
              </option>
            </select>
          </label>

          <label className="field">
            <span>
              {t(
                "Representative document number"
              )}
            </span>

            <input
              value={
                form
                  .representativeDocumentNumber
              }
              onChange={
                (event) =>
                  setValue(
                    "representativeDocumentNumber",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>
        </div>
      </Section>

      <Section
        icon={Users}
        title="Commercial Contact"
        status="Pricing, quotations and negotiation"
      >
        <ContactFields
          legend="Commercial Contact"
          value={
            form
              .commercialContact
          }
          onChange={
            (
              field,
              value
            ) =>
              setContact(
                "commercialContact",
                field,
                value
              )
          }
        />
      </Section>

      <Section
        icon={Truck}
        title="Operations / Logistics Contact"
        status="Dispatch, delivery and logistics coordination"
      >
        <ContactFields
          legend="Operations / Logistics Contact"
          value={
            form
              .operationsContact
          }
          onChange={
            (
              field,
              value
            ) =>
              setContact(
                "operationsContact",
                field,
                value
              )
          }
        />
      </Section>

      <Section
        icon={Truck}
        title="Commercial Conditions"
        status="RCO-FOR-002 · Section 3"
      >
        <div className="form-grid supplier-form-grid">
          <label className="field">
            <span>
              {t(
                "Billing Currency"
              )}
            </span>

            <select
              value={
                form
                  .currency
              }
              onChange={
                (event) =>
                  setValue(
                    "currency",
                    event
                      .target
                      .value
                  )
              }
            >
              <option value="PEN">
                PEN
              </option>

              <option value="USD">
                USD
              </option>
            </select>
          </label>

          <label className="field">
            <span>
              {t(
                "Payment Terms"
              )}
            </span>

            <select
              value={
                form
                  .paymentTermOption
              }
              onChange={
                (event) =>
                  setValue(
                    "paymentTermOption",
                    event
                      .target
                      .value
                  )
              }
            >
              <option value="CREDIT_30">
                {t(
                  "CREDIT_30"
                )}
              </option>

              <option value="CREDIT_45">
                {t(
                  "CREDIT_45"
                )}
              </option>

              <option value="CUSTOM">
                {t(
                  "CUSTOM"
                )}
              </option>
            </select>
          </label>

          {
            form
              .paymentTermOption ===
              "CUSTOM" && (
              <label className="field">
                <span>
                  {t(
                    "Custom credit days"
                  )}
                </span>

                <input
                  type="number"
                  min="1"
                  value={
                    form
                      .paymentTermDays
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "paymentTermDays",
                        event
                          .target
                          .value
                      )
                  }
                />
              </label>
            )
          }

          <label className="field">
            <span>
              {t(
                "Payment comments"
              )}
            </span>

            <input
              value={
                form
                  .paymentTermComments
              }
              onChange={
                (event) =>
                  setValue(
                    "paymentTermComments",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field field-span-2">
            <span>
              {t(
                "Goods / services profile"
              )}
            </span>

            <textarea
              rows="2"
              value={
                form
                  .goodsServicesProfile
              }
              onChange={
                (event) =>
                  setValue(
                    "goodsServicesProfile",
                    event
                      .target
                      .value
                  )
              }
            />
          </label>

          <label className="field">
            <span>
              {t(
                "Delivery Method"
              )}
            </span>

            <select
              value={
                form
                  .deliveryMethod
              }
              onChange={
                (event) =>
                  setValue(
                    "deliveryMethod",
                    event
                      .target
                      .value
                  )
              }
            >
              <option value="CENTRAL_WAREHOUSE">
                {t(
                  "CENTRAL_WAREHOUSE"
                )}
              </option>

              <option value="DESTINATION_SITE">
                {t(
                  "DESTINATION_SITE"
                )}
              </option>

              <option value="OTHER">
                {t(
                  "OTHER"
                )}
              </option>
            </select>
          </label>

          {
            form
              .deliveryMethod ===
              "OTHER" && (
              <label className="field">
                <span>
                  {t(
                    "Other delivery method"
                  )}
                </span>

                <input
                  value={
                    form
                      .deliveryOther
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "deliveryOther",
                        event
                          .target
                          .value
                      )
                  }
                />
              </label>
            )
          }

          <label className="field field-span-2">
            <span>
              {t(
                "Registration justification"
              )} *
            </span>

            <textarea
              rows="3"
              value={
                form
                  .proposalJustification
              }
              onChange={
                (event) =>
                  setValue(
                    "proposalJustification",
                    event
                      .target
                      .value
                  )
              }
              required
            />
          </label>
        </div>
      </Section>

      {
        includeInitialBank && (
          <Section
            icon={Landmark}
            title="Initial Banking Information"
            status="New accounts begin Pending Finance Review"
          >
            <div className="form-grid supplier-form-grid">
              <label className="field">
                <span>
                  {t(
                    "Bank"
                  )}
                </span>

                <select
                  value={
                    form.bank
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "bank",
                        event
                          .target
                          .value
                      )
                  }
                >
                  <option value="">
                    {t(
                      "Add after saving"
                    )}
                  </option>

                  {
                    [
                      "BCP",
                      "BBVA",
                      "INTERBANK",
                      "SCOTIABANK",
                      "BANCO_NACION"
                    ].map(
                      (item) => (
                        <option
                          key={
                            item
                          }
                          value={
                            item
                          }
                        >
                          {t(
                            item
                          )}
                        </option>
                      )
                    )
                  }
                </select>
              </label>

              <label className="field">
                <span>
                  {t(
                    "Account Type"
                  )}
                </span>

                <select
                  value={
                    form
                      .accountType
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "accountType",
                        event
                          .target
                          .value
                      )
                  }
                >
                  <option value="CURRENT">
                    {t(
                      "CURRENT"
                    )}
                  </option>

                  <option value="DETRACTION">
                    {t(
                      "DETRACTION"
                    )}
                  </option>
                </select>
              </label>

              <label className="field">
                <span>
                  {t(
                    "Account Number"
                  )}
                </span>

                <input
                  value={
                    form
                      .accountNumber
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "accountNumber",
                        event
                          .target
                          .value
                      )
                  }
                  inputMode="numeric"
                />
              </label>

              <label className="field">
                <span>
                  {t(
                    "CCI (20 digits)"
                  )}
                </span>

                <input
                  value={
                    form.cci
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "cci",
                        event
                          .target
                          .value
                      )
                  }
                  inputMode="numeric"
                  maxLength="24"
                />
              </label>

              <label className="field">
                <span>
                  {t(
                    "Account Currency"
                  )}
                </span>

                <select
                  value={
                    form
                      .accountCurrency
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "accountCurrency",
                        event
                          .target
                          .value
                      )
                  }
                >
                  <option value="PEN">
                    PEN
                  </option>

                  <option value="USD">
                    USD
                  </option>
                </select>
              </label>

              <label className="field">
                <span>
                  {t(
                    "Account Holder Name"
                  )}
                </span>

                <input
                  value={
                    form
                      .accountHolderName
                  }
                  onChange={
                    (event) =>
                      setValue(
                        "accountHolderName",
                        event
                          .target
                          .value
                      )
                  }
                />
              </label>
            </div>

            {
              form
                .accountType ===
                "DETRACTION" && (
                <p className="section-note warning-note">
                  {t(
                    "Detraction accounts must use Banco de la Nacion. This does not classify the supplier as subject to detraction."
                  )}
                </p>
              )
            }
          </Section>
        )
      }

      <Section
        icon={ShieldCheck}
        title="Compliance Declarations"
        status="Both answers are required before homologation"
      >
        <div className="declaration-grid">
          <fieldset className="declaration-field">
            <legend>
              {t(
                "Does the company or its partners have State sanctions or relevant proceedings?"
              )}
            </legend>

            <div
              className="segmented-control"
              role="group"
            >
              {
                [
                  "YES",
                  "NO",
                  "NOT_DECLARED"
                ].map(
                  (
                    answer
                  ) => (
                    <button
                      key={
                        answer
                      }
                      type="button"
                      className={
                        form
                          .stateSanctionsAnswer ===
                        answer
                          ? "active"
                          : ""
                      }
                      onClick={
                        () =>
                          setValue(
                            "stateSanctionsAnswer",
                            answer
                          )
                      }
                    >
                      {t(
                        answer
                      )}
                    </button>
                  )
                )
              }
            </div>

            <label className="field">
              <span>
                {t(
                  "Declaration comments"
                )}
              </span>

              <textarea
                rows="2"
                value={
                  form
                    .stateSanctionsComments
                }
                onChange={
                  (event) =>
                    setValue(
                      "stateSanctionsComments",
                      event
                        .target
                        .value
                    )
                }
              />
            </label>
          </fieldset>

          <fieldset className="declaration-field">
            <legend>
              {t(
                "Does the company have a compliance officer or prevention model?"
              )}
            </legend>

            <div
              className="segmented-control"
              role="group"
            >
              {
                [
                  "YES",
                  "NO",
                  "NOT_DECLARED"
                ].map(
                  (
                    answer
                  ) => (
                    <button
                      key={
                        answer
                      }
                      type="button"
                      className={
                        form
                          .complianceModelAnswer ===
                        answer
                          ? "active"
                          : ""
                      }
                      onClick={
                        () =>
                          setValue(
                            "complianceModelAnswer",
                            answer
                          )
                      }
                    >
                      {t(
                        answer
                      )}
                    </button>
                  )
                )
              }
            </div>

            <label className="field">
              <span>
                {t(
                  "Declaration comments"
                )}
              </span>

              <textarea
                rows="2"
                value={
                  form
                    .complianceModelComments
                }
                onChange={
                  (event) =>
                    setValue(
                      "complianceModelComments",
                      event
                        .target
                        .value
                    )
                }
              />
            </label>
          </fieldset>
        </div>
      </Section>

      <Section
        icon={FileCheck2}
        title="Mandatory Documents"
        status="Required for final homologation"
      >
        <div className="document-upload-grid">
          {
            [
              [
                "rucFile",
                "RUC_FILE",
                "Updated RUC document"
              ],

              [
                "legalRepId",
                "LEGAL_REP_ID",
                "Legal representative identification"
              ],

              [
                "bankCertificate",
                "BANK_CERTIFICATE",
                "Official bank certificate"
              ]
            ].map(
              ([
                field,
                kind,
                label
              ]) => (
                <label
                  className="file-field"
                  key={
                    field
                  }
                >
                  <span>
                    {t(
                      label
                    )}
                  </span>

                  <small
                    className={
                      documentKinds.has(
                        kind
                      )
                        ? "text-success"
                        : ""
                    }
                  >
                    {t(
                      documentKinds.has(
                        kind
                      )
                        ? "Already uploaded"
                        : "Not uploaded"
                    )}
                  </small>

                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={
                      (event) =>
                        setFiles(
                          (
                            current
                          ) => ({
                            ...current,

                            [field]:
                              event
                                .target
                                .files
                                ?.[0]
                          })
                        )
                    }
                  />
                </label>
              )
            )
          }
        </div>
      </Section>

      <footer className="supplier-form-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={
            onCancel
          }
          disabled={
            loading
          }
        >
          {t(
            "Cancel"
          )}
        </button>

        <button
          type="submit"
          className="primary-button"
          disabled={
            loading
          }
          aria-busy={
            loading
          }
        >
          <Save
            size={16}
            aria-hidden="true"
          />

          <span>
            {t(
              loading
                ? "Saving..."
                : supplier
                  ? "Save corrections"
                  : "Create supplier proposal"
            )}
          </span>
        </button>
      </footer>
    </form>
  );
}