import { Router } from 'express';
import { getCompany, updateCompanyConfig } from '../controllers/companyController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import { UpdateCompanyConfigSchema, UserRole } from '@highp/shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/', getCompany);
router.patch(
  '/configuration',
  requireRoles([UserRole.OWNER, UserRole.ADMIN]),
  validate(UpdateCompanyConfigSchema),
  updateCompanyConfig
);

export default router;
