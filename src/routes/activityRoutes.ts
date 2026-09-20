import { Router } from 'express';
import { getTimeline, getRecentActivity } from '../controllers/activityController';
import { authenticateUser } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/:employeeId/timeline', getTimeline);
router.get('/', getRecentActivity);

export default router;
