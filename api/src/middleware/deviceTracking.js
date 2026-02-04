/**
 * Device tracking middleware
 * Tracks active devices for subscription enforcement
 */

const { db } = require('../db');
const crypto = require('crypto');

/**
 * Generate device fingerprint from request
 */
function getDeviceFingerprint(req) {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Create hash from user agent + IP
  const hash = crypto
    .createHash('sha256')
    .update(`${userAgent}:${ip}`)
    .digest('hex')
    .substring(0, 32);
  
  return hash;
}

/**
 * Middleware to track device session
 */
async function trackDeviceSession(req, res, next) {
  try {
    const user = req.user;
    if (!user || !user.tenant_id) {
      return next();
    }

    const deviceId = getDeviceFingerprint(req);
    const deviceType = detectDeviceType(req.headers['user-agent']);
    
    // Upsert device session
    await db('device_sessions')
      .insert({
        tenant_id: user.tenant_id,
        branch_id: user.branch_id,
        staff_id: user.staff_id,
        device_id: deviceId,
        device_name: req.headers['x-device-name'] || `${deviceType} Device`,
        device_type: deviceType,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        last_seen: db.fn.now()
      })
      .onConflict(['tenant_id', 'device_id'])
      .merge({
        last_seen: db.fn.now(),
        staff_id: user.staff_id,
        branch_id: user.branch_id
      });

    // Attach device info to request
    req.deviceId = deviceId;
    req.deviceType = deviceType;
    
    next();
  } catch (err) {
    console.error('Device tracking error:', err);
    next(); // Don't block request on tracking error
  }
}

/**
 * Detect device type from user agent
 */
function detectDeviceType(userAgent = '') {
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('electron')) return 'desktop';
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('ios')) return 'mobile';
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
  return 'browser';
}

/**
 * Clean up old device sessions (call periodically)
 */
async function cleanupDeviceSessions() {
  try {
    const deleted = await db('device_sessions')
      .where('last_seen', '<', db.raw('datetime("now", "-2 hours")'))
      .delete();
    
    console.log(`Cleaned up ${deleted} stale device sessions`);
  } catch (err) {
    console.error('Device cleanup error:', err);
  }
}

module.exports = {
  trackDeviceSession,
  getDeviceFingerprint,
  detectDeviceType,
  cleanupDeviceSessions
};
