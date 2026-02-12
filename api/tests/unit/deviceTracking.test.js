const {
  getDeviceFingerprint,
  detectDeviceType,
  trackDeviceSession,
} = require('../../src/middleware/deviceTracking');

const { db } = require('../../src/db');

describe('deviceTracking middleware', () => {
  it('detectDeviceType detects desktop/mobile/tablet/browser', () => {
    expect(detectDeviceType('Electron/25')).toBe('desktop');
    expect(detectDeviceType('Mozilla Android')).toBe('mobile');
    expect(detectDeviceType('iPad')).toBe('tablet');
    expect(detectDeviceType('Mozilla')).toBe('browser');
  });

  it('getDeviceFingerprint returns a stable 32-char hash', () => {
    const req = {
      headers: { 'user-agent': 'UA' },
      ip: '1.2.3.4',
      connection: { remoteAddress: '1.2.3.4' },
    };

    const a = getDeviceFingerprint(req);
    const b = getDeviceFingerprint(req);

    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('trackDeviceSession no-ops when user missing tenant_id', async () => {
    const req = { headers: {}, user: null };
    const next = jest.fn();

    await trackDeviceSession(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('trackDeviceSession attaches device info and calls next', async () => {
    db.fn = db.fn || {};
    db.fn.now = db.fn.now || jest.fn(() => new Date().toISOString());

    const req = {
      headers: { 'user-agent': 'Electron', 'x-device-name': 'Front Desk' },
      ip: '10.0.0.1',
      connection: { remoteAddress: '10.0.0.1' },
      user: { tenant_id: 't_test', branch_id: 'b_1', staff_id: 's_1' },
    };

    const next = jest.fn();

    await trackDeviceSession(req, {}, next);

    expect(req.deviceId).toBeTruthy();
    expect(req.deviceType).toBe('desktop');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
