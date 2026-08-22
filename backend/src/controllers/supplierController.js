import { asyncHandler } from "../middleware/asyncHandler.js";

import {
  getSupplierPadronPrefill
} from "../services/supplierPadronLookupService.js";

import {
  addSupplierBankAccount,
  createSupplierProposal,
  deactivateSupplierBankAccount,
  deactivateSupplier,
  getSupplierDetailPayload,
  getSupplierHomologationReadiness,
  homologateSupplier,
  listSuppliersPage,
  lookupSupplierByIdentifier,
  reviewSupplierCompliance,
  setPreferredSupplierBankAccount,
  updateSupplierProposal,
  validateSupplierTaxpayer,
  verifySupplierBankAccount,
  updateAndReviewSupplier
} from "../services/supplierService.js";

export const listSuppliers =
  asyncHandler(
    async (req, res) => {
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
    async (req, res) => {
      res.json(
        await lookupSupplierByIdentifier(
          req.params.identifier,
          req.user
        )
      );
    }
  );

export const lookupSupplierPadron =
  asyncHandler(
    async (req, res) => {
      res.json(
        await getSupplierPadronPrefill(
          req.params.ruc
        )
      );
    }
  );

export const getSupplier =
  asyncHandler(
    async (req, res) => {
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
    async (req, res) => {
      res.json({
        data:
          await getSupplierHomologationReadiness(
            req.params.id
          )
      });
    }
  );

export const createSupplier =
  asyncHandler(
    async (req, res) => {
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
              result.supplier._id,
              req.user
            ),

          warnings:
            result.warnings
        });
    }
  );

export const updateSupplierProposalFields =
  asyncHandler(
    async (req, res) => {
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
            result.supplier._id,
            req.user
          ),

        warnings:
          result.warnings
      });
    }
  );

export const updateSupplier =
  asyncHandler(
    async (req, res) => {
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
            result.supplier._id,
            req.user
          ),

        warnings:
          result.warnings
      });
    }
  );

export const addBankAccount =
  asyncHandler(
    async (req, res) => {
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
    async (req, res) => {
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
    async (req, res) => {
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
    async (req, res) => {
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
    async (req, res) => {
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

export const reviewSupplier =
  asyncHandler(
    async (req, res) => {
      await reviewSupplierCompliance({
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

export const homologate =
  asyncHandler(
    async (req, res) => {
      const result =
        await homologateSupplier({
          supplierId:
            req.params.id,

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
    async (req, res) => {
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