import { Router } from 'express';
import {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getDashboardOverview
} from '../controllers/employeeController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import { CreateEmployeeSchema, UpdateEmployeeSchema, UserRole } from '@highp/shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.get('/overview', requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getDashboardOverview);
router.get('/', requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getEmployees);
router.get('/:id', getEmployeeById);

router.post(
  '/',
  requireRoles([UserRole.OWNER, UserRole.ADMIN]),
  validate(CreateEmployeeSchema),
  createEmployee
);

router.patch(
  '/:id',
  requireRoles([UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]),
  validate(UpdateEmployeeSchema),
  updateEmployee
);

router.delete('/:id', requireRoles([UserRole.OWNER, UserRole.ADMIN]), deleteEmployee);

export default router;
