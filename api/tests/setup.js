
// Silence pino logger during tests
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
    requestLogger: (req, res, next) => next(),
    createRequestLogger: jest.fn().mockReturnThis(),
    createServiceLogger: jest.fn().mockReturnThis(),
}));

// Set reasonable timeout
jest.setTimeout(30000);
