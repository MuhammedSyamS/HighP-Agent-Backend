import { Router } from 'express';
import {
  startSession,
  endSession,
  getAttendanceSessions,
  getAttendanceDailyRoster,
  getEmployeeAttendance,
  attendanceHeartbeat,
  getAttendanceMonthly
} from '../controllers/attendanceController';
import { authenticateUser } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.post('/start', startSession);
router.post('/end', endSession);
router.post('/heartbeat', attendanceHeartbeat);
router.get('/roster', getAttendanceDailyRoster);
router.get('/monthly', getAttendanceMonthly);
router.get('/', getAttendanceSessions);
router.get('/:employeeId', getEmployeeAttendance);

export default router;
