import { Router } from 'express';
import { getDevices, revokeDevice } from '../controllers/deviceController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { UserRole } from '@highp/shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/', requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getDevices);
router.post('/:id/revoke', requireRoles([UserRole.OWNER, UserRole.ADMIN]), revokeDevice);

export default router;
