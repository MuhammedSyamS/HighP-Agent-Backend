import { Router } from 'express';
import {
  register,
  signup,
  login,
  refresh,
  getMe,
  logout,
  resetPassword,
  sendOtp,
  verifyOtpLogin,
  resetPasswordOtp
} from '../controllers/authController';
import { validate } from '../middleware/validate';
import { authenticateUser } from '../middleware/auth';
import { RegisterCompanySchema, SignupSchema, LoginSchema, RefreshTokenSchema } from '../shared';

const router = Router();

router.post('/register', validate(RegisterCompanySchema), register);
router.post('/signup', validate(SignupSchema), signup);
router.post('/login', validate(LoginSchema), login);
router.post('/refresh', validate(RefreshTokenSchema), refresh);
router.post('/reset-password', resetPassword);

// OTP Authentication & Password Reset Routes
router.post('/otp/send', sendOtp);
router.post('/otp/verify-login', verifyOtpLogin);
router.post('/otp/reset-password', resetPasswordOtp);

router.get('/me', authenticateUser, getMe);
router.post('/logout', authenticateUser, logout);

export default router;
