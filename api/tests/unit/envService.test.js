jest.mock('fs');

describe('envService.updateEnv', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...prevEnv };
    jest.resetModules();

    const fs = require('fs');
    fs.existsSync.mockReset();
    fs.readFileSync.mockReset();
    fs.writeFileSync.mockReset();
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  it('updates existing key in .env content', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('A=1\nJWT_SECRET=old\n#comment\n\n');

    const { updateEnv } = require('../../src/utils/envService');
    updateEnv('JWT_SECRET', 'newsecret');

    expect(process.env.JWT_SECRET).toBe('newsecret');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

    const written = String(fs.writeFileSync.mock.calls[0][1]);
    expect(written).toContain('JWT_SECRET=newsecret');
    expect(written).toContain('A=1');
    expect(written).toContain('#comment');
  });

  it('appends key when not found and quotes values with spaces', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('A=1\n');

    const { updateEnv } = require('../../src/utils/envService');
    updateEnv('MY_KEY', 'hello world');

    const written = String(fs.writeFileSync.mock.calls[0][1]);
    expect(written).toContain('A=1');
    expect(written).toMatch(/\nMY_KEY="hello world"/);
  });

  it('throws a friendly error when write fails', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    const { updateEnv } = require('../../src/utils/envService');
    expect(() => updateEnv('X', '1')).toThrow('Failed to save configuration to environment file');
  });
});
