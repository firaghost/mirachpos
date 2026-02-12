/**
 * FCM Push Notification Routes
 * 
 * Endpoints:
 * - POST /auth/fcm-token - Register device token
 * - DELETE /auth/fcm-token - Unregister device token
 * - GET /auth/fcm-preferences - Get notification preferences
 * - PUT /auth/fcm-preferences - Update notification preferences
 * - POST /owner/fcm-broadcast - Send broadcast to all staff (owner only)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireRole } = require('../middleware/permissions');
const fcmService = require('../services/fcmService');

const makeFCMRouter = () => {
  const r = express.Router();

  // Register FCM token (authenticated users)
  r.post('/auth/fcm-token', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      const { token, deviceType, deviceName } = req.body || {};

      if (!token) {
        return res.status(400).json({ ok: false, error: 'token_required' });
      }

      const result = await fcmService.registerToken({
        tenantId: req.tenant.id,
        staffId: req.auth.staffId,
        token,
        deviceType,
        deviceName,
      });

      if (!result.ok) {
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  });

  // Unregister FCM token (logout or disable notifications)
  r.delete('/auth/fcm-token', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      const { token } = req.body || {};

      if (!token) {
        return res.status(400).json({ ok: false, error: 'token_required' });
      }

      const result = await fcmService.deactivateToken(token);

      if (!result.ok) {
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  });

  // Get user's devices/tokens
  r.get('/auth/fcm-devices', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      const tokens = await fcmService.getUserTokens(req.tenant.id, req.auth.staffId);

      return res.json({
        ok: true,
        devices: tokens.map(t => ({
          id: t.id,
          deviceType: t.device_type,
          deviceName: t.device_name,
        })),
      });
    } catch (e) {
      return next(e);
    }
  });

  // Get notification preferences
  r.get('/auth/fcm-preferences', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      const prefs = await fcmService.getUserPreferences(req.tenant.id, req.auth.staffId);

      return res.json({
        ok: true,
        preferences: prefs,
      });
    } catch (e) {
      return next(e);
    }
  });

  // Update notification preferences
  r.put('/auth/fcm-preferences', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      const { preferences } = req.body || {};

      if (!preferences || typeof preferences !== 'object') {
        return res.status(400).json({ ok: false, error: 'preferences_required' });
      }

      const result = await fcmService.updateUserPreferences(
        req.tenant.id,
        req.auth.staffId,
        preferences
      );

      if (!result.ok) {
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  });

  // Owner: Send broadcast notification to all staff
  r.post('/owner/fcm-broadcast', tenantMiddleware, requireAuth, requireRole('Cafe Owner'), async (req, res, next) => {
    try {
      const { title, body, data, imageUrl, clickAction } = req.body || {};

      if (!title || !body) {
        return res.status(400).json({ ok: false, error: 'title_and_body_required' });
      }

      const result = await fcmService.sendBroadcast({
        tenantId: req.tenant.id,
        title,
        body,
        data,
        imageUrl,
        clickAction,
      });

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  });

  // Owner: Send notification to specific staff members
  r.post('/owner/fcm-send', tenantMiddleware, requireAuth, requireRole('Cafe Owner'), async (req, res, next) => {
    try {
      const { staffIds, title, body, data, imageUrl, clickAction } = req.body || {};

      if (!staffIds || !Array.isArray(staffIds) || staffIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'staff_ids_required' });
      }

      if (!title || !body) {
        return res.status(400).json({ ok: false, error: 'title_and_body_required' });
      }

      const result = await fcmService.sendToUsers({
        tenantId: req.tenant.id,
        staffIds,
        title,
        body,
        data,
        imageUrl,
        clickAction,
      });

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeFCMRouter };
