
module.exports = {
    testEnvironment: 'node',
    verbose: true,
    detectOpenHandles: true,
    testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    coverageDirectory: './coverage',
    coverageThreshold: {
        global: {
            statements: 80,
            branches: 65,
            functions: 80,
            lines: 80,
        },
    },
    collectCoverageFrom: [
        'src/utils/**/*.js',
        'src/services/**/*.js',
        'src/middleware/**/*.js',
        'src/metrics.js',
        'src/config.js',
        '!src/db.js',
        '!src/utils/telebirr/sign-util-lib.js',
        '!src/utils/telebirr/standingOrderCrypto.js',
        '!src/migrations/**',
        '!src/routes/**',
    ],
};
