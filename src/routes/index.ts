import { Router } from 'express';
import authRoutes from './authRoutes';
import companyRoutes from './companyRoutes';
import employeeRoutes from './employeeRoutes';
import attendanceRoutes from './attendanceRoutes';
import breakRoutes from './breakRoutes';
import activityRoutes from './activityRoutes';
import applicationRoutes from './applicationRoutes';
import reportRoutes from './reportRoutes';
import agentRoutes from './agentRoutes';
import deviceRoutes from './deviceRoutes';
import settingRoutes from './settingRoutes';
import auditLogRoutes from './auditLogRoutes';

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/company', companyRoutes);
router.use('/employees', employeeRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/breaks', breakRoutes);
router.use('/activity', activityRoutes);
router.use('/applications', applicationRoutes);
router.use('/reports', reportRoutes);
router.use('/agent', agentRoutes);
router.use('/devices', deviceRoutes);
router.use('/settings', settingRoutes);
router.use('/audit-logs', auditLogRoutes);

export default router;

