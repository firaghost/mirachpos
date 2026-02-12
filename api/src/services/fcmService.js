/**
 * Firebase Cloud Messaging (FCM) Push Notification Service
 * 
 * Provides:
 * - Device token registration/management
 * - Push notification sending via Firebase Admin SDK
 * - Delivery tracking and retry logic
 */

const { db } = require('../db');
const { makeId } = require('../utils/ids');

// Lazy-loaded Firebase Admin SDK
let firebaseAdmin = null;
let firebaseApp = null;

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    return JSON.parse(String(raw)) ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * Initialize Firebase Admin SDK
 * Call this once at startup if FCM is configured
 */
const initializeFCM = () => {
  if (firebaseApp) return true;

  try {
    // Check for service account key in environment or config
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      console.log('[FCM] No service account key configured - FCM disabled');
      return false;
    }

    let credentials;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch {
      console.error('[FCM] Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON');
      return false;
    }

    firebaseAdmin = require('firebase-admin');
    firebaseApp = firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(credentials),
    });

    console.log('[FCM] Firebase Admin SDK initialized');
    return true;
  } catch (error) {
    console.error('[FCM] Failed to initialize:', error.message);
    return false;
  }
};

/**
 * Get FCM enabled status from platform config
 */
const isFCMEnabled = async () => {
  try {
    const row = await db()
      .select(['fcm_config_json'])
      .from('platform_payment_config')
      .where({ id: 1 })
      .first();

    const config = safeJsonParse(row?.fcm_config_json, {});
    return config.enabled === true && !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  } catch {
    return false;
  }
};

/**
 * Register or update FCM token for a user
 */
const registerToken = async ({ tenantId, staffId, token, deviceType, deviceName }) => {
  if (!tenantId || !staffId || !token) {
    return { ok: false, error: 'missing_required_fields' };
  }

  const nowIso = new Date().toISOString();

  try {
    // Check if token already exists
    const existing = await db()
      .select(['id', 'staff_id'])
      .from('fcm_tokens')
      .where({ token })
      .first();

    if (existing) {
      // Update existing token (may have changed hands or device)
      await db('fcm_tokens')
        .where({ id: existing.id })
        .update({
          tenant_id: tenantId,
          staff_id: staffId,
          device_type: deviceType || null,
          device_name: deviceName || null,
          is_active: true,
          last_used_at: nowIso,
          updated_at: nowIso,
        });

      return { ok: true, tokenId: existing.id, action: 'updated' };
    }

    // Create new token record
    const tokenId = makeId('fcm');
    await db('fcm_tokens').insert({
      id: tokenId,
      tenant_id: tenantId,
      staff_id: staffId,
      token,
      device_type: deviceType || null,
      device_name: deviceName || null,
      is_active: true,
      last_used_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    });

    return { ok: true, tokenId, action: 'created' };
  } catch (error) {
    console.error('[FCM] Token registration failed:', error.message);
    return { ok: false, error: 'registration_failed' };
  }
};

/**
 * Deactivate a token (user logout or token invalid)
 */
const deactivateToken = async (token) => {
  if (!token) return { ok: false, error: 'missing_token' };

  try {
    const result = await db('fcm_tokens')
      .where({ token })
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      });

    return { ok: true, deactivated: result > 0 };
  } catch (error) {
    console.error('[FCM] Token deactivation failed:', error.message);
    return { ok: false, error: 'deactivation_failed' };
  }
};

/**
 * Get active FCM tokens for a user
 */
const getUserTokens = async (tenantId, staffId) => {
  if (!tenantId || !staffId) return [];

  try {
    return await db()
      .select(['id', 'token', 'device_type', 'device_name'])
      .from('fcm_tokens')
      .where({
        tenant_id: tenantId,
        staff_id: staffId,
        is_active: true,
      })
      .orderBy('last_used_at', 'desc');
  } catch (error) {
    console.error('[FCM] Get user tokens failed:', error.message);
    return [];
  }
};

/**
 * Get all active tokens for a tenant (for broadcast)
 */
const getTenantTokens = async (tenantId, options = {}) => {
  if (!tenantId) return [];

  const { staffIds, limit = 1000 } = options;

  try {
    let query = db()
      .select(['id', 'token', 'staff_id', 'device_type'])
      .from('fcm_tokens')
      .where({
        tenant_id: tenantId,
        is_active: true,
      })
      .limit(limit);

    if (staffIds && staffIds.length > 0) {
      query = query.whereIn('staff_id', staffIds);
    }

    return await query;
  } catch (error) {
    console.error('[FCM] Get tenant tokens failed:', error.message);
    return [];
  }
};

/**
 * Send push notification to a single device
 */
const sendPushNotification = async ({ tokenId, token, title, body, data, imageUrl, clickAction }) => {
  if (!firebaseApp && !initializeFCM()) {
    return { ok: false, error: 'fcm_not_initialized' };
  }

  const nowIso = new Date().toISOString();

  try {
    const message = {
      token,
      notification: {
        title,
        body,
        ...(imageUrl && { imageUrl }),
      },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'mirachpos_default',
          priority: 'high',
          sound: 'default',
          ...(clickAction && { clickAction }),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        headers: {
          Urgency: 'high',
        },
        notification: {
          icon: '/icon-192x192.png',
          badge: '/badge-72x72.png',
          ...(clickAction && { clickAction }),
        },
      },
    };

    const response = await firebaseAdmin.messaging().send(message);

    return {
      ok: true,
      messageId: response,
      sentAt: nowIso,
    };
  } catch (error) {
    console.error('[FCM] Send failed:', error.message);

    // Handle specific FCM errors
    const errorCode = error.code || error.errorInfo?.code;
    if (errorCode === 'messaging/registration-token-not-registered' ||
        errorCode === 'messaging/invalid-registration-token') {
      // Token is invalid - deactivate it
      await deactivateToken(token);
      return { ok: false, error: 'invalid_token', deactivated: true };
    }

    return { ok: false, error: 'send_failed', message: error.message };
  }
};

/**
 * Send notification to a user (all their devices)
 */
const sendToUser = async ({ tenantId, staffId, title, body, data, imageUrl, clickAction, entityType, entityId }) => {
  if (!await isFCMEnabled()) {
    return { ok: false, error: 'fcm_disabled' };
  }

  const tokens = await getUserTokens(tenantId, staffId);
  if (tokens.length === 0) {
    return { ok: false, error: 'no_active_tokens' };
  }

  const results = [];
  const pushId = makeId('push');
  const nowIso = new Date().toISOString();

  for (const { id: tokenId, token, device_type } of tokens) {
    // Log the attempt
    await db('push_notifications').insert({
      id: makeId('push'),
      tenant_id: tenantId,
      staff_id: staffId,
      fcm_token_id: tokenId,
      title,
      body,
      image_url: imageUrl || null,
      data_json: data ? JSON.stringify(data) : null,
      click_action: clickAction || null,
      status: 'pending',
      entity_type: entityType || null,
      entity_id: entityId || null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const result = await sendPushNotification({
      tokenId,
      token,
      title,
      body,
      data,
      imageUrl,
      clickAction,
    });

    results.push({
      tokenId,
      deviceType: device_type,
      ...result,
    });
  }

  const successCount = results.filter(r => r.ok).length;

  return {
    ok: successCount > 0,
    totalDevices: tokens.length,
    successful: successCount,
    failed: tokens.length - successCount,
    results,
  };
};

/**
 * Send notification to multiple users (batch)
 */
const sendToUsers = async ({ tenantId, staffIds, title, body, data, imageUrl, clickAction }) => {
  if (!await isFCMEnabled()) {
    return { ok: false, error: 'fcm_disabled' };
  }

  if (!staffIds || staffIds.length === 0) {
    return { ok: false, error: 'no_recipients' };
  }

  const results = [];
  for (const staffId of staffIds) {
    const result = await sendToUser({
      tenantId,
      staffId,
      title,
      body,
      data,
      imageUrl,
      clickAction,
    });
    results.push({ staffId, ...result });
  }

  const totalSuccessful = results.reduce((sum, r) => sum + (r.successful || 0), 0);

  return {
    ok: totalSuccessful > 0,
    totalRecipients: staffIds.length,
    totalSuccessful,
    results,
  };
};

/**
 * Send broadcast to all users in a tenant
 */
const sendBroadcast = async ({ tenantId, title, body, data, imageUrl, clickAction }) => {
  if (!await isFCMEnabled()) {
    return { ok: false, error: 'fcm_disabled' };
  }

  const tokens = await getTenantTokens(tenantId);
  if (tokens.length === 0) {
    return { ok: false, error: 'no_active_tokens' };
  }

  // Use multicast for efficiency
  const tokenList = tokens.map(t => t.token);
  const nowIso = new Date().toISOString();

  try {
    const message = {
      tokens: tokenList,
      notification: {
        title,
        body,
        ...(imageUrl && { imageUrl }),
      },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'mirachpos_default',
          priority: 'high',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        headers: {
          Urgency: 'high',
        },
        notification: {
          icon: '/icon-192x192.png',
          badge: '/badge-72x72.png',
        },
      },
    };

    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);

    // Update token statuses based on results
    for (let i = 0; i < response.responses.length; i++) {
      const resp = response.responses[i];
      const tokenRecord = tokens[i];

      if (!resp.success) {
        const error = resp.error;
        if (error?.code === 'messaging/registration-token-not-registered' ||
            error?.code === 'messaging/invalid-registration-token') {
          await deactivateToken(tokenRecord.token);
        }
      }
    }

    return {
      ok: true,
      totalDevices: tokenList.length,
      successful: response.successCount,
      failed: response.failureCount,
    };
  } catch (error) {
    console.error('[FCM] Broadcast failed:', error.message);
    return { ok: false, error: 'broadcast_failed', message: error.message };
  }
};

/**
 * Get user's push notification preferences
 */
const getUserPreferences = async (tenantId, staffId) => {
  try {
    const row = await db()
      .select(['push_notification_prefs_json'])
      .from('staff')
      .where({ tenant_id: tenantId, id: staffId })
      .first();

    const defaults = {
      enabled: true,
      orderUpdates: true,
      billingAlerts: true,
      inventoryAlerts: true,
      shiftReminders: true,
      marketing: false,
    };

    return { ...defaults, ...safeJsonParse(row?.push_notification_prefs_json, {}) };
  } catch {
    return {
      enabled: true,
      orderUpdates: true,
      billingAlerts: true,
      inventoryAlerts: true,
      shiftReminders: true,
      marketing: false,
    };
  }
};

/**
 * Update user's push notification preferences
 */
const updateUserPreferences = async (tenantId, staffId, prefs) => {
  try {
    const nowIso = new Date().toISOString();
    await db('staff')
      .where({ tenant_id: tenantId, id: staffId })
      .update({
        push_notification_prefs_json: JSON.stringify(prefs),
        updated_at: nowIso,
      });

    return { ok: true };
  } catch (error) {
    console.error('[FCM] Update preferences failed:', error.message);
    return { ok: false, error: 'update_failed' };
  }
};

/**
 * Cleanup old/invalid tokens (maintenance job)
 */
const cleanupTokens = async (maxAgeDays = 90) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
  const cutoffIso = cutoffDate.toISOString();

  try {
    const result = await db('fcm_tokens')
      .where(function () {
        this.where('is_active', false)
          .andWhere('updated_at', '<', cutoffIso);
      })
      .orWhere(function () {
        this.where('last_used_at', '<', cutoffIso)
          .andWhere('is_active', false);
      })
      .delete();

    return { ok: true, deleted: result };
  } catch (error) {
    console.error('[FCM] Cleanup failed:', error.message);
    return { ok: false, error: 'cleanup_failed' };
  }
};

module.exports = {
  initializeFCM,
  isFCMEnabled,
  registerToken,
  deactivateToken,
  getUserTokens,
  getTenantTokens,
  sendPushNotification,
  sendToUser,
  sendToUsers,
  sendBroadcast,
  getUserPreferences,
  updateUserPreferences,
  cleanupTokens,
};
