describe('services/integrationService', () => {
  beforeEach(() => {
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    if (!state?.tables) return;

    state.tables.tenant_integrations = [];
    state.tables.integrations_catalog = [];

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('sendSlackNotification returns ok=false when webhookUrl missing', async () => {
    const { sendSlackNotification } = require('../../src/services/integrationService');
    const res = await sendSlackNotification({ webhookUrl: '', message: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/webhook/i);
  });

  it('sendTelegramNotification returns ok=false when bot token or chat id missing', async () => {
    const { sendTelegramNotification } = require('../../src/services/integrationService');
    const res = await sendTelegramNotification({ botToken: '', chatId: '', message: 'hi' });
    expect(res.ok).toBe(false);
  });

  it('forwardWebhook returns ok/status/response on success', async () => {
    const { forwardWebhook } = require('../../src/services/integrationService');

    const res = await forwardWebhook({ url: 'https://example.com', payload: { a: 1 } });

    expect(res).toEqual({ ok: true, status: 200, response: 'ok' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('forwardWebhook returns ok=false for non-https urls', async () => {
    const { forwardWebhook } = require('../../src/services/integrationService');
    const res = await forwardWebhook({ url: 'http://example.com', payload: { a: 1 } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/https/i);
  });

  it('forwardWebhook returns ok=false for localhost urls', async () => {
    const { forwardWebhook } = require('../../src/services/integrationService');
    const res = await forwardWebhook({ url: 'https://localhost/test', payload: { a: 1 } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not allowed/i);
  });

  it('testIntegration returns unknown integration error', async () => {
    const { testIntegration } = require('../../src/services/integrationService');
    const res = await testIntegration({ integrationCode: 'nope', config: {} });
    expect(res).toEqual({ ok: false, error: 'Unknown integration: nope' });
  });

  it('sendOrderNotification returns ok with sent=0 when tenant has no integrations', async () => {
    const { sendOrderNotification } = require('../../src/services/integrationService');

    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: '{}' },
      eventType: 'created',
    });

    expect(res).toEqual({ ok: true, sent: 0 });
  });

  it('sendOrderNotification sends for active slack integration and returns results', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_integrations = [
      {
        id: 'ti_1',
        tenant_id: 't1',
        status: 'active',
        integration_id: 'ic_1',
        config_json: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXX', channel: '#c' }),
      },
    ];

    state.tables.integrations_catalog = [{ id: 'ic_1', code: 'slack' }];

    const { sendOrderNotification } = require('../../src/services/integrationService');

    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: JSON.stringify({ items: [{ name: 'Tea', qty: 2 }], tableName: 'T1' }) },
      eventType: 'paid',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(1);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].code).toBe('slack');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sendSlackNotification returns ok=false when Slack API returns non-OK', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }));

    const { sendSlackNotification } = require('../../src/services/integrationService');
    const res = await sendSlackNotification({ webhookUrl: 'https://hooks.slack.com/test', message: 'hi' });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Internal Server Error/);
  });

  it('sendSlackNotification handles fetch errors gracefully', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network error'); });

    const { sendSlackNotification } = require('../../src/services/integrationService');
    const res = await sendSlackNotification({ webhookUrl: 'https://hooks.slack.com/test', message: 'hi' });

    expect(res.ok).toBe(false);
  });

  it('sendTelegramNotification returns ok=true on success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const { sendTelegramNotification } = require('../../src/services/integrationService');
    const res = await sendTelegramNotification({ botToken: 'token123', chatId: 'chat456', message: 'Hello' });

    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken123/sendMessage',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sendTelegramNotification returns ok=false when API returns error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
    }));

    const { sendTelegramNotification } = require('../../src/services/integrationService');
    const res = await sendTelegramNotification({ botToken: 'token', chatId: 'bad', message: 'hi' });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Bad Request/);
  });

  it('forwardWebhook returns ok=false on fetch error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Connection refused'); });

    const { forwardWebhook } = require('../../src/services/integrationService');
    const res = await forwardWebhook({ url: 'https://example.com', payload: {} });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Connection refused/);
  });

  it('testIntegration sends Slack test notification', async () => {
    const { testIntegration } = require('../../src/services/integrationService');
    const res = await testIntegration({ integrationCode: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/YYY', channel: '#test' } });

    expect(res.ok).toBe(true);
  });

  it('testIntegration sends Telegram test notification', async () => {
    const { testIntegration } = require('../../src/services/integrationService');
    const res = await testIntegration({ integrationCode: 'telegram', config: { botToken: 'token', chatId: 'chat' } });

    expect(res.ok).toBe(true);
  });

  it('testIntegration forwards webhook test', async () => {
    const { testIntegration } = require('../../src/services/integrationService');
    const res = await testIntegration({ integrationCode: 'webhook', config: { url: 'https://test.com' } });

    expect(res.ok).toBe(true);
  });

  it('sendOrderNotification handles telegram integration', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_integrations = [
      {
        id: 'ti_1',
        tenant_id: 't1',
        status: 'active',
        integration_id: 'ic_1',
        config_json: JSON.stringify({ botToken: 'token', chatId: 'chat' }),
      },
    ];
    state.tables.integrations_catalog = [{ id: 'ic_1', code: 'telegram' }];

    const { sendOrderNotification } = require('../../src/services/integrationService');
    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: '{}' },
      eventType: 'created',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(1);
  });

  it('sendOrderNotification handles webhook integration', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_integrations = [
      {
        id: 'ti_1',
        tenant_id: 't1',
        status: 'active',
        integration_id: 'ic_1',
        config_json: JSON.stringify({ url: 'https://webhook.test', headers: { 'X-Auth': 'token' } }),
      },
    ];
    state.tables.integrations_catalog = [{ id: 'ic_1', code: 'webhook' }];

    const { sendOrderNotification } = require('../../src/services/integrationService');
    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: '{}' },
      eventType: 'created',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(1);
  });

  it('sendOrderNotification skips unknown integration codes', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_integrations = [
      {
        id: 'ti_1',
        tenant_id: 't1',
        status: 'active',
        integration_id: 'ic_1',
        config_json: JSON.stringify({}),
      },
    ];
    state.tables.integrations_catalog = [{ id: 'ic_1', code: 'unknown_integration' }];

    const { sendOrderNotification } = require('../../src/services/integrationService');
    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: '{}' },
      eventType: 'created',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(0);
  });

  it('sendOrderNotification handles missing catalog gracefully', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.tenant_integrations = [
      {
        id: 'ti_1',
        tenant_id: 't1',
        status: 'active',
        integration_id: 'ic_1',
        config_json: JSON.stringify({ webhookUrl: 'https://test' }),
      },
    ];
    // No catalog entry - should skip without error
    state.tables.integrations_catalog = [];

    const { sendOrderNotification } = require('../../src/services/integrationService');
    const res = await sendOrderNotification({
      tenantId: 't1',
      branchId: 'br_1',
      order: { id: 'o1', total: 10, payload: '{}' },
      eventType: 'created',
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(0);
  });
});
