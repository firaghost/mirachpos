describe('middleware/uploadSecurity', () => {
  const mkRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    return res;
  };

  it('passes through when there are no files', async () => {
    await jest.isolateModulesAsync(async () => {
      const { validateFileUpload } = require('../../src/middleware/uploadSecurity');

      const req = { files: [] };
      const res = mkRes();
      const next = jest.fn();

      validateFileUpload(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    });
  });

  it('rejects file too large with 413', async () => {
    await jest.isolateModulesAsync(async () => {
      const { validateFileUpload, MAX_FILE_SIZE } = require('../../src/middleware/uploadSecurity');

      const req = {
        files: [{ size: MAX_FILE_SIZE + 1, mimetype: 'image/png', originalname: 'x.png' }],
      };
      const res = mkRes();
      const next = jest.fn();

      validateFileUpload(req, res, next);

      expect(res.statusCode).toBe(413);
      expect(res.body?.error).toBe('file_too_large');
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid mimetype with 415', async () => {
    await jest.isolateModulesAsync(async () => {
      const { validateFileUpload } = require('../../src/middleware/uploadSecurity');

      const req = {
        files: [{ size: 10, mimetype: 'application/x-msdownload', originalname: 'x.exe' }],
      };
      const res = mkRes();
      const next = jest.fn();

      validateFileUpload(req, res, next);

      expect(res.statusCode).toBe(415);
      expect(res.body?.error).toBe('invalid_file_type');
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('rejects extension mismatch with 415', async () => {
    await jest.isolateModulesAsync(async () => {
      const { validateFileUpload } = require('../../src/middleware/uploadSecurity');

      const req = {
        files: [{ size: 10, mimetype: 'image/png', originalname: 'x.jpg' }],
      };
      const res = mkRes();
      const next = jest.fn();

      validateFileUpload(req, res, next);

      expect(res.statusCode).toBe(415);
      expect(res.body?.error).toBe('extension_mismatch');
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('assigns safeName for valid files', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('crypto', () => ({
        randomBytes: () => ({ toString: () => 'a'.repeat(32) }),
      }));

      const { validateFileUpload } = require('../../src/middleware/uploadSecurity');

      const req = {
        files: [{ size: 10, mimetype: 'image/png', originalname: 'x.png' }],
      };
      const res = mkRes();
      const next = jest.fn();

      validateFileUpload(req, res, next);

      expect(req.files[0].safeName).toBe(`${'a'.repeat(32)}.png`);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
