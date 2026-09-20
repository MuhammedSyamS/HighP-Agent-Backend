import { Router } from 'express';
import { getAuditLogs } from '../controllers/auditLogController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { UserRole } from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);
router.use(requireRoles([UserRole.OWNER, UserRole.ADMIN]));

router.get('/', getAuditLogs);

export default router;
