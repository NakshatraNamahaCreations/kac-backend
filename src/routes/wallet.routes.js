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

// Agent-scoped — the customer wallet below has no role requirement since
// every user has a customer coin balance regardless of their role list.
walletRouter.get('/wallet', requireRole('agent'), asyncHandler(getWallet));
walletRouter.get('/wallet/ledger', requireRole('agent'), asyncHandler(getWalletLedger));
walletRouter.post('/wallet/bank-accounts', requireRole('agent'), asyncHandler(addBankAccount));
walletRouter.post('/wallet/withdraw', requireRole('agent'), asyncHandler(withdraw));

walletRouter.get('/wallet/customer', asyncHandler(getCustomerWallet));
walletRouter.get('/wallet/customer/ledger', asyncHandler(getCustomerWalletLedger));
walletRouter.post('/wallet/customer/recharge', asyncHandler(rechargeCustomerWallet));
walletRouter.post('/wallet/customer/debit', asyncHandler(debitCustomerWallet));

module.exports = { walletRouter };
