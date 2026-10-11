import { Router } from 'express';
import {
  getPayrollSummary,
  getEmployeePayroll,
  updateEmployeeRate,
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

export default router;
