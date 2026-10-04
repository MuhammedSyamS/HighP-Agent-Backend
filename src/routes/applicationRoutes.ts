import { Router } from 'express';
import {
  getCompanyApplicationUsage,
  getCompanyWebsiteUsage,
  getEmployeeApplicationUsage,
  getRegistryApplications,
  createRegistryApplication,
  updateRegistryApplication,
  deleteRegistryApplication,
  toggleRegistryApplicationTracking,
  getDiscoveredApplications,
  convertDiscoveredApplication,
  dismissDiscoveredApplication
} from '../controllers/applicationController';
import { authenticateUser, requireRoles } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import {
  UserRole,
  CreateTrackedApplicationSchema,
  UpdateTrackedApplicationSchema,
  ToggleApplicationTrackingSchema,
  ConvertDiscoveredApplicationSchema
} from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

// Usage Analytics
router.get('/usage', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getCompanyApplicationUsage);
router.get('/websites', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getCompanyWebsiteUsage);
router.get('/usage/:employeeId', getEmployeeApplicationUsage);

// Application Registry CRUD
router.get('/', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getRegistryApplications);
router.post('/', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), validate(CreateTrackedApplicationSchema), createRegistryApplication);
router.put('/:id', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), validate(UpdateTrackedApplicationSchema), updateRegistryApplication);
router.delete('/:id', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), deleteRegistryApplication);
router.patch('/:id/tracking', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), validate(ToggleApplicationTrackingSchema), toggleRegistryApplicationTracking);

// Discovered Applications
router.get('/discovered', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER]), getDiscoveredApplications);
router.post('/discovered/:id/convert', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), validate(ConvertDiscoveredApplicationSchema), convertDiscoveredApplication);
router.delete('/discovered/:id', requireRoles([UserRole.HR, UserRole.OWNER, UserRole.ADMIN]), dismissDiscoveredApplication);

export default router;
