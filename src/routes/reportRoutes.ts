import { Router } from 'express';
import { getDaily, getWeekly, getMonthly, exportReport } from '../controllers/reportController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { UserRole } from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);
router.use(requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]));

router.get('/daily', getDaily);
router.get('/weekly', getWeekly);
router.get('/monthly', getMonthly);
router.get('/export', exportReport);

export default router;

