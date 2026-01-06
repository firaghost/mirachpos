const crypto = require('crypto');

const normalizePem = (pem) => {
  if (!pem) return '';
  const s = String(pem);
  if (s.includes('BEGIN')) return s;
  // Allow env var with \n
  return s.replace(/\\n/g, '\n');
};

const sha256Base64 = (input) => {
  return crypto.createHash('sha256').update(input).digest('base64');
};

const signStringPssBase64 = (text, privateKeyPem) => {
  const key = normalizePem(privateKeyPem);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(text);
  sign.end();
  return sign.sign({
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }, 'base64');
};

const verifyStringPssBase64 = (text, signatureB64, publicKeyPem) => {
  const key = normalizePem(publicKeyPem);
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(text);
  verify.end();
  return verify.verify({
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }, signatureB64, 'base64');
};

const rsaEncryptBase64 = (plainText, publicKeyPem) => {
  const key = normalizePem(publicKeyPem);
  const buf = Buffer.from(String(plainText), 'utf8');
  // NOTE: Exact padding (OAEP/PKCS1) depends on Telebirr contract.
  // OAEP with SHA256 is a secure default; adjust if Telebirr requires PKCS1.
  const encrypted = crypto.publicEncrypt(
    {
      key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buf,
  );
  return encrypted.toString('base64');
};

const rsaDecryptBase64 = (cipherB64, privateKeyPem) => {
  const key = normalizePem(privateKeyPem);
  const buf = Buffer.from(String(cipherB64 || ''), 'base64');
  const decrypted = crypto.privateDecrypt(
    {
      key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buf,
  );
  return decrypted.toString('utf8');
};

module.exports = {
  normalizePem,
  sha256Base64,
  rsaEncryptBase64,
  rsaDecryptBase64,
  signStringPssBase64,
  verifyStringPssBase64,
};
