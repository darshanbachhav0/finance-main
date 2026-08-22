import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  createEmployeeReimbursementBankAccount,
  deactivateEmployeeReimbursementBankAccount,
  listEmployeeReimbursementBankAccounts,
  reviewEmployeeReimbursementBankAccount,
  setPreferredEmployeeReimbursementBankAccount,
  updateEmployeeReimbursementBankAccount
} from "../services/employeeReimbursementBankService.js";

export const listAccounts = asyncHandler(async (req, res) => {
  res.json({ data: await listEmployeeReimbursementBankAccounts({ query: req.query, user: req.user }) });
});

export const createAccount = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createEmployeeReimbursementBankAccount({ payload: req.body, user: req.user, req }) });
});

export const updateAccount = asyncHandler(async (req, res) => {
  res.json({ data: await updateEmployeeReimbursementBankAccount({ accountId: req.params.id, payload: req.body, user: req.user, req }) });
});

export const selectPreferred = asyncHandler(async (req, res) => {
  res.json({ data: await setPreferredEmployeeReimbursementBankAccount({ accountId: req.params.id, user: req.user, req }) });
});

export const deactivateAccount = asyncHandler(async (req, res) => {
  res.json({ data: await deactivateEmployeeReimbursementBankAccount({ accountId: req.params.id, user: req.user, req }) });
});

export const reviewAccount = asyncHandler(async (req, res) => {
  res.json({ data: await reviewEmployeeReimbursementBankAccount({ accountId: req.params.id, payload: req.body, user: req.user, req }) });
});
