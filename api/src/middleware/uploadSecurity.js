const path = require('path');
const crypto = require('crypto');

const ALLOWED_MIME_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/csv': ['.csv'],
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const validateFileUpload = (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return next();

  for (const file of files) {
    if (Number(file.size || 0) > MAX_FILE_SIZE) {
      return res.status(413).json({
        error: 'file_too_large',
        message: 'File size exceeds 5MB limit',
      });
    }

    const allowedExtensions = ALLOWED_MIME_TYPES[file.mimetype];
    if (!allowedExtensions) {
      return res.status(415).json({
        error: 'invalid_file_type',
        message: 'File type not allowed',
      });
    }

    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(415).json({
        error: 'extension_mismatch',
        message: 'File extension does not match content type',
      });
    }

    file.safeName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  }

  return next();
};

module.exports = { validateFileUpload, ALLOWED_MIME_TYPES, MAX_FILE_SIZE };
