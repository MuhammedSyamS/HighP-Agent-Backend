import { Router } from 'express';
import {
  registerDevice,
  heartbeat,
  recordActivity,
  syncOfflineEvents,
  getAgentConfig,
  startAgentSession,
  endAgentSession
} from '../controllers/agentController';
import { authenticateAgent } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import { AgentRegisterSchema, AgentHeartbeatSchema, AgentSyncSchema } from '../shared';

const router = Router();

router.use(authenticateAgent);
router.use(enforceTenant);

router.post('/register', validate(AgentRegisterSchema), registerDevice);
router.post('/heartbeat', validate(AgentHeartbeatSchema), heartbeat);
router.post('/activity', recordActivity);
router.post('/sync', validate(AgentSyncSchema), syncOfflineEvents);
router.get('/configuration', getAgentConfig);
router.post('/session/start', startAgentSession);
router.post('/session/end', endAgentSession);

export default router;
