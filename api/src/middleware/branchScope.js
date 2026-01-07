const normalizeBranchId = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s === 'global') return '';
  if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
  return s;
};

const resolveBranchId = (req) => {
  const role = String(req.auth?.role || '').trim();
  const fromToken = normalizeBranchId(req.auth?.branchId);
  const q = typeof req.query?.branchId === 'string' ? normalizeBranchId(req.query.branchId) : '';

  if (role === 'Cafe Owner' && (!fromToken || fromToken === 'global')) {
    return q || '';
  }

  return fromToken;
};

const resolveBranchIdFromBody = (req, body) => {
  const role = String(req.auth?.role || '').trim();
  const fromToken = normalizeBranchId(req.auth?.branchId);
  const q = typeof req.query?.branchId === 'string' ? normalizeBranchId(req.query.branchId) : '';

  const fromBody = body && typeof body === 'object' && typeof body.branchId === 'string' ? normalizeBranchId(body.branchId) : '';

  if (role === 'Cafe Owner' && (!fromToken || fromToken === 'global')) {
    return fromBody || q || '';
  }

  return fromToken;
};

const requireBranchId = () => (req, res, next) => {
  const branchId = resolveBranchId(req);
  if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });
  req.branchId = branchId;
  return next();
};

const requireBranchIdFromBody = () => (req, res, next) => {
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  const branchId = resolveBranchIdFromBody(req, body);
  if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });
  req.branchId = branchId;
  return next();
};

module.exports = {
  resolveBranchId,
  resolveBranchIdFromBody,
  requireBranchId,
  requireBranchIdFromBody,
};
