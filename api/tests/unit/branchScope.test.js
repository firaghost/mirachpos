const {
  resolveBranchId,
  resolveBranchIdFromBody,
  requireBranchId,
  requireBranchIdFromBody,
} = require('../../src/middleware/branchScope');

describe('middleware/branchScope', () => {
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

  it('resolveBranchId allows owner/manager to override branchId via query when token branch is empty/global', () => {
    const req = {
      auth: { role: 'Cafe Owner', branchId: 'global' },
      query: { branchId: 'b_1' },
    };

    expect(resolveBranchId(req)).toBe('br_1');
  });

  it('resolveBranchId prefers token branch for non-owner roles', () => {
    const req = {
      auth: { role: 'Cashier', branchId: 'b_2' },
      query: { branchId: 'b_1' },
    };

    expect(resolveBranchId(req)).toBe('br_2');
  });

  it('resolveBranchIdFromBody uses body.branchId first for owner/manager when token branch is empty/global', () => {
    const req = {
      auth: { role: 'Waiter Manager', branchId: '' },
      query: { branchId: 'b_9' },
    };

    expect(resolveBranchIdFromBody(req, { branchId: 'b_3' })).toBe('br_3');
  });

  it('requireBranchId returns 400 when branch is missing', () => {
    const mw = requireBranchId();

    const req = {
      auth: { role: 'Cafe Owner', branchId: '' },
      query: {},
    };
    const res = mkRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'branch_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireBranchIdFromBody sets req.branchId and calls next', () => {
    const mw = requireBranchIdFromBody();

    const req = {
      auth: { role: 'Cafe Owner', branchId: '' },
      query: {},
      body: { branchId: 'b_7' },
    };
    const res = mkRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(req.branchId).toBe('br_7');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
