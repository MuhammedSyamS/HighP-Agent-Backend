import { Router } from 'express';
import { getCompany, updateCompanyConfig } from '../controllers/companyController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import { UpdateCompanyConfigSchema, UserRole } from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);
router.use(requireRoles([UserRole.OWNER, UserRole.ADMIN]));

router.get('/', getCompany);
router.patch('/', validate(UpdateCompanyConfigSchema), updateCompanyConfig);

export default router;
