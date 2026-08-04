const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { addBankAccount, getWallet, getWalletLedger, withdraw } = require('../controllers/wallet.controller');
const {
  getWallet: getCustomerWallet,
  getWalletLedger: getCustomerWalletLedger,
  recharge: rechargeCustomerWallet,
  debit: debitCustomerWallet,
} = require('../controllers/customerWallet.controller');

const walletRouter = Router();
walletRouter.use(requireAuth);

// Agent-or-vendor-scoped — vendor screens reuse this same endpoint (the
// wallet container is an Agent document either way; see requireOwnAgent in
// wallet.controller.js). The customer wallet below has no role requirement
// since every user has a customer coin balance regardless of their role list.
walletRouter.get('/wallet', requireRole('agent', 'vendor'), asyncHandler(getWallet));
walletRouter.get('/wallet/ledger', requireRole('agent', 'vendor'), asyncHandler(getWalletLedger));
walletRouter.post('/wallet/bank-accounts', requireRole('agent', 'vendor'), asyncHandler(addBankAccount));
walletRouter.post('/wallet/withdraw', requireRole('agent', 'vendor'), asyncHandler(withdraw));

walletRouter.get('/wallet/customer', asyncHandler(getCustomerWallet));
walletRouter.get('/wallet/customer/ledger', asyncHandler(getCustomerWalletLedger));
walletRouter.post('/wallet/customer/recharge', asyncHandler(rechargeCustomerWallet));
walletRouter.post('/wallet/customer/debit', asyncHandler(debitCustomerWallet));

module.exports = { walletRouter };
