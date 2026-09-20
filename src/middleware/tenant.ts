import { Request, Response, NextFunction } from 'express';

export const enforceTenant = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || !req.user.companyId) {
    res.status(401).json({ success: false, message: 'Unauthorized. No tenant context found.' });
    return;
  }

  // Ensure request has companyId attached
  req.companyId = req.user.companyId;

  // Protect against malicious body override of companyId
  if (req.body && typeof req.body === 'object') {
    req.body.companyId = req.user.companyId;
  }

  next();
};
