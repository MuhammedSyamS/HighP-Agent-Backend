import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message
        }));
        const detailedMessage = issues.map((i) => i.message).join(', ');
        res.status(400).json({
          success: false,
          message: detailedMessage || 'Validation failed',
          errors: issues
        });
        return;
      }
      res.status(400).json({ success: false, message: 'Invalid request payload' });
    }
  };
};
