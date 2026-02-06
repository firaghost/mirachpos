
module.exports = {
    testEnvironment: 'node',
    verbose: true,
    testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    coverageDirectory: './coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/db.js', // Exclude DB config from coverage
        '!src/migrations/**',
    ],
};
