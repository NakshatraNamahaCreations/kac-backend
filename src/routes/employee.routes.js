const { Router } = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  getEmployeeDashboard,
  getEmployeeStats,
  listEmployeeReferralUsers,
  registerEmployee,
  verifyEmployeeCode,
} = require('../controllers/employee.controller');

const employeeRouter = Router();
employeeRouter.use(requireAuth);

employeeRouter.post('/employee/verify-code', asyncHandler(verifyEmployeeCode));
employeeRouter.post('/employee/register', asyncHandler(registerEmployee));
employeeRouter.get('/employee/dashboard', asyncHandler(getEmployeeDashboard));
employeeRouter.get('/employee/stats', asyncHandler(getEmployeeStats));
employeeRouter.get('/employee/referral-users', asyncHandler(listEmployeeReferralUsers));

module.exports = { employeeRouter };
