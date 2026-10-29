import { refreshForLookup } from "../services/sunatPadronService.js";
import { assistedConsultaAvailable, lookupAssistedConsultaRuc } from "../services/sunatAssistedLookupService.js";
import { AppError } from "../utils/AppError.js";
import {
  asyncHandler
} from "../middleware/asyncHandler.js";

import {
  getSupplierAutomaticPrefill
} from "../services/supplierPadronLookupService.js";

import {
  lookupSunatLegalRepresentatives
} from "../services/sunatConsultaRucRepresentativesService.js";

import {
  addSupplierBankAccount,
  createSupplierProposal,
  decideSupplierApproval,
  deactivateSupplierBankAccount,
  deactivateSupplier,
  getSupplierDetailPayload,
  getSupplierHomologationReadiness,
  listSuppliersPage,
  lookupSupplierByIdentifier,
  setPreferredSupplierBankAccount,
  updateSupplierProposal,
  validateSupplierTaxpayer,
  verifySupplierBankAccount,
  updateAndReviewSupplier,
  updateSupplierDepartments,
  requestSupplierAccess
} from "../services/supplierService.js";

import {
  listSupplierDepartments
} from "../services/supplierVisibilityService.js";

export const listSuppliers =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json(
        await listSuppliersPage(
          req.query,
          req.user
        )
      );
    }
  );

export const lookupSupplier =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json(
        await lookupSupplierByIdentifier(
          req.params.identifier,
          req.user
        )
      );
    }
  );

// The legacy /padron URL now uses the configured source (Consulta RUC by default).
export const lookupSupplierPadron =
  asyncHandler(
    async (
      req,
      res
    ) => {
      try {
        res.json(await getSupplierAutomaticPrefill(req.params.ruc));
      } catch (error) {
        if (error.statusCode === 503) {
          const retryable = error.details?.retryable !== false;
          if (retryable) {
            refreshForLookup();
            res.set("Retry-After", "15");
          }
          error.details = { ...error.details, assistedAvailable: assistedConsultaAvailable(req) && !error.details?.requiresConfiguration, lookupState: "UNAVAILABLE", ...(retryable ? { retryAfterSeconds: 15 } : {}) };
        }
        throw error;
      }
    }
  );

const assistedLookups = new Set();
export const lookupSupplierAssisted = asyncHandler(async (req, res) => {
  if (!assistedConsultaAvailable(req)) throw new AppError(403, "SUNAT browser verification is available only on the local Windows development computer.");
  const userId = String(req.user._id);
  if (assistedLookups.has(userId)) throw new AppError(409, "A SUNAT browser verification is already open. Complete or close it first.");
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  assistedLookups.add(userId);
  res.once("close", abort);
  try {
    const profile = await lookupAssistedConsultaRuc(req.params.ruc, { signal: controller.signal });
    if (!res.destroyed) res.json(profile);
  } finally {
    res.off("close", abort);
    assistedLookups.delete(userId);
  }
});

/*
 * Additional public SUNAT Consulta RUC lookup.
 *
 * This retrieves legal representatives separately so that
 * supplier creation does not have to wait for SUNAT's website
 * before showing Padron data.
 */
export const lookupSupplierLegalRepresentatives =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const legalName =
        String(
          req.query
            .legalName ||
          ""
        ).trim();

      try {
        res.json(await lookupSunatLegalRepresentatives(req.params.ruc, legalName));
      } catch (error) {
        if (error.statusCode === 503) {
          res.set("Retry-After", "30");
        }
        throw error;
      }
    }
  );

export const getSupplier =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

export const getHomologationReadiness =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json({
        data:
          await getSupplierHomologationReadiness(
            req.params.id,
            req.user
          )
      });
    }
  );

export const createSupplier =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await createSupplierProposal({
          payload:
            req.body,

          files:
            req.files,

          user:
            req.user,

          req
        });

      res
        .status(201)
        .json({
          data:
            await getSupplierDetailPayload(
              result
                .supplier
                ._id,
              req.user
            ),

          warnings:
            result.warnings
        });
    }
  );

export const updateSupplierProposalFields =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await updateSupplierProposal({
          supplierId:
            req.params.id,

          payload:
            req.body,

          files:
            req.files,

          user:
            req.user,

          req
        });

      res.json({
        data:
          await getSupplierDetailPayload(
            result
              .supplier
              ._id,
            req.user
          ),

        warnings:
          result.warnings
      });
    }
  );

export const updateSupplier =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await updateAndReviewSupplier({
          supplierId:
            req.params.id,

          payload:
            req.body,

          files:
            req.files,

          user:
            req.user,

          req
        });

      res.json({
        data:
          await getSupplierDetailPayload(
            result
              .supplier
              ._id,
            req.user
          ),

        warnings:
          result.warnings
      });
    }
  );

export const addBankAccount =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await addSupplierBankAccount({
          supplierId:
            req.params.id,

          payload:
            req.body,

          user:
            req.user,

          req
        });

      res
        .status(201)
        .json({
          data:
            await getSupplierDetailPayload(
              req.params.id,
              req.user
            ),

          warnings:
            result.warnings
        });
    }
  );

export const verifyBankAccount =
  asyncHandler(
    async (
      req,
      res
    ) => {
      await verifySupplierBankAccount({
        supplierId:
          req.params.id,

        accountId:
          req.params.accountId,

        payload:
          req.body,

        user:
          req.user,

        req
      });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

export const selectPreferredBankAccount =
  asyncHandler(
    async (
      req,
      res
    ) => {
      await setPreferredSupplierBankAccount({
        supplierId:
          req.params.id,

        accountId:
          req.params.accountId,

        user:
          req.user,

        req
      });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

export const removeBankAccount =
  asyncHandler(
    async (
      req,
      res
    ) => {
      await deactivateSupplierBankAccount({
        supplierId:
          req.params.id,

        accountId:
          req.params.accountId,

        user:
          req.user,

        req
      });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

export const validateTaxpayer =
  asyncHandler(
    async (
      req,
      res
    ) => {
      await validateSupplierTaxpayer({
        supplierId:
          req.params.id,

        payload:
          req.body,

        user:
          req.user,

        req
      });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

// Treasury or the proposer's jefe approves, observes or rejects the supplier.
export const decideApproval =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await decideSupplierApproval({
          supplierId:
            req.params.id,

          payload:
            req.body,

          user:
            req.user,

          req
        });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          ),

        assignedCode:
          result.assignedCode
      });
    }
  );

export const deleteSupplier =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const supplier =
        await deactivateSupplier({
          supplierId:
            req.params.id,

          user:
            req.user,

          req
        });

      res.json({
        data:
          await getSupplierDetailPayload(
            supplier._id,
            req.user
          )
      });
    }
  );
/*
 * Suppliers by area: the areas a supplier can be shared with, Accounting/Admin choosing them, and a
 * requester asking for another area's supplier.
 */
export const listDepartments =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json({
        data:
          await listSupplierDepartments()
      });
    }
  );

export const updateDepartments =
  asyncHandler(
    async (
      req,
      res
    ) => {
      await updateSupplierDepartments({
        supplierId:
          req.params.id,

        departments:
          req.body.departments,

        user:
          req.user,

        req
      });

      res.json({
        data:
          await getSupplierDetailPayload(
            req.params.id,
            req.user
          )
      });
    }
  );

export const requestAccess =
  asyncHandler(
    async (
      req,
      res
    ) => {
      res.json({
        data:
          await requestSupplierAccess({
            supplierId:
              req.params.id,

            reason:
              req.body?.reason,

            user:
              req.user,

            req
          })
      });
    }
  );
