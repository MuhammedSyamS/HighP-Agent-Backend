import { Router } from 'express';
import {
  getPayrollSummary,
  getEmployeePayroll,
  updateEmployeeRate,
  updatePayoutStatus,
  bulkUpdatePayoutStatus,
  bulkUpdateCompanyPolicy,
  exportPayrollCsv
} from '../controllers/payrollController';
import { authenticateUser } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/summary', getPayrollSummary);
router.get('/export', exportPayrollCsv);
router.get('/employee/:employeeId', getEmployeePayroll);
router.patch('/employee/:employeeId/rate', updateEmployeeRate);
router.patch('/employee/:employeeId/payout-status', updatePayoutStatus);
router.patch('/bulk-payout-status', bulkUpdatePayoutStatus);
router.post('/bulk-policy', bulkUpdateCompanyPolicy);

export default router;
