import { Router } from 'express';
import { start, end, getBreaks } from '../controllers/breakController';
import { authenticateUser } from '../middleware/auth';
import { enforceTenant } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import { StartBreakSchema, EndBreakSchema } from '../shared';

const router = Router();

router.use(authenticateUser);
router.use(enforceTenant);

router.post('/start', validate(StartBreakSchema), start);
router.post('/end', validate(EndBreakSchema), end);
router.get('/', getBreaks);

export default router;
