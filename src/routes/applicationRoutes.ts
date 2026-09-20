import { Router } from 'express';
import { getCompanyApplicationUsage, getEmployeeApplicationUsage } from '../controllers/applicationController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { UserRole } from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/usage', requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getCompanyApplicationUsage);
router.get('/usage/:employeeId', getEmployeeApplicationUsage);

export default router;
