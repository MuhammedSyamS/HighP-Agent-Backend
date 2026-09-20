"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceTenant = void 0;
const enforceTenant = (req, res, next) => {
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
exports.enforceTenant = enforceTenant;
