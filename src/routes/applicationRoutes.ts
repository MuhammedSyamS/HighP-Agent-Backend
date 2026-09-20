import { Router } from 'express';
import { getCompanyApplicationUsage, getEmployeeApplicationUsage } from '../controllers/applicationController';
import { authenticateUser } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/usage', getCompanyApplicationUsage);
router.get('/usage/:employeeId', getEmployeeApplicationUsage);

export default router;
