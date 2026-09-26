import { Router } from 'express';
import { register, signup, login, refresh, getMe, logout, resetPassword } from '../controllers/authController';
import { validate } from '../middleware/validate';
import { authenticateUser } from '../middleware/auth';
import { RegisterCompanySchema, SignupSchema, LoginSchema, RefreshTokenSchema } from '../shared';

const router = Router();

router.post('/register', validate(RegisterCompanySchema), register);
router.post('/signup', validate(SignupSchema), signup);
router.post('/login', validate(LoginSchema), login);
router.post('/refresh', validate(RefreshTokenSchema), refresh);
router.post('/reset-password', resetPassword);
router.get('/me', authenticateUser, getMe);
router.post('/logout', authenticateUser, logout);

export default router;
