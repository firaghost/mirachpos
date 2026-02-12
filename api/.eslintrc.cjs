module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
  },
  plugins: ['import'],
  extends: ['eslint:recommended', 'plugin:import/recommended'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-dupe-keys': 'off',
    'no-case-declarations': 'off',
    'no-empty': 'off',
    'no-useless-escape': 'off',
    'no-control-regex': 'off',
    'no-useless-catch': 'off',
    'import/no-unresolved': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'coverage/',
    'migrations/',
    'src/dataconnect-admin-generated/',
    'src/utils/telebirr/',
    'src/services/telebirrStandingOrderService.js',
    'tests/complete-test-suite.js',
  ],
};
