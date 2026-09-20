"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const zod_1 = require("zod");
const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        try {
            req[source] = schema.parse(req[source]);
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
                const issues = error.issues.map((i) => ({
                    field: i.path.join('.'),
                    message: i.message
                }));
                res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: issues
                });
                return;
            }
            res.status(400).json({ success: false, message: 'Invalid request payload' });
        }
    };
};
exports.validate = validate;
