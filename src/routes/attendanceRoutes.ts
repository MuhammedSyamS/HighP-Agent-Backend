import { Router } from 'express';
import {
  startSession,
  endSession,
  getAttendanceSessions,
  getAttendanceDailyRoster,
  getEmployeeAttendance,
  attendanceHeartbeat,
  getAttendanceMonthly,
  updateAttendanceSession,
  deleteAttendanceSession,
  createManualAttendance,
  updateEmployeeDayAttendance,
  deleteEmployeeDayAttendance
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
router.patch('/roster/status', updateEmployeeDayAttendance);
router.delete('/employee/:employeeId/date/:date', deleteEmployeeDayAttendance);
router.post('/manual', createManualAttendance);
router.get('/monthly', getAttendanceMonthly);
router.get('/', getAttendanceSessions);
router.get('/:employeeId', getEmployeeAttendance);
router.put('/session/:id', updateAttendanceSession);
router.delete('/session/:id', deleteAttendanceSession);
router.put('/:id', updateAttendanceSession);
router.delete('/:id', deleteAttendanceSession);

export default router;

