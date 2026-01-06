/**
 * Input Validation Middleware (Zod)
 * 
 * Schema-based validation for API inputs.
 * Prevents invalid/malicious data from reaching handlers.
 */

const { z } = require('zod');
const { ValidationError } = require('../utils/errors');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Login schema
const loginSchema = z.object({
    email: z
        .string({ required_error: 'Email is required' })
        .email('Invalid email format')
        .max(255, 'Email too long'),
    password: z
        .string({ required_error: 'Password is required' })
        .min(1, 'Password is required')
        .max(255, 'Password too long'),
});

// Payment submission schema
const paymentSubmissionSchema = z.object({
    method: z
        .enum(['bank_transfer', 'chapa', 'telebirr', 'cbe_birr'], {
            errorMap: () => ({ message: 'Invalid payment method' }),
        }),
    reference: z
        .string()
        .max(255, 'Reference too long')
        .optional(),
});

// Invoice creation schema
const createInvoiceSchema = z.object({
    lineItems: z
        .array(
            z.object({
                description: z.string().min(1).max(255),
                qty: z.number().int().positive(),
                unitPrice: z.number().min(0),
                amount: z.number().min(0),
            })
        )
        .min(1, 'At least one line item required'),
    dueInDays: z.number().int().min(1).max(365).optional(),
    notes: z.string().max(1000).optional(),
});

// Plan change request schema
const planChangeSchema = z.object({
    tier: z.enum(['Basic', 'Pro', 'Enterprise'], {
        errorMap: () => ({ message: 'Invalid plan tier' }),
    }),
    cycle: z.enum(['Monthly', 'Yearly'], {
        errorMap: () => ({ message: 'Invalid billing cycle' }),
    }),
});

// Tenant creation schema
const createTenantSchema = z.object({
    name: z
        .string({ required_error: 'Business name is required' })
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name too long'),
    slug: z
        .string()
        .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes')
        .min(2)
        .max(50)
        .optional(),
    ownerEmail: z.string().email('Invalid email format').optional(),
    ownerPhone: z.string().max(20).optional(),
});

// Staff creation schema
const createStaffSchema = z.object({
    name: z
        .string({ required_error: 'Name is required' })
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name too long'),
    email: z.string().email('Invalid email format').optional(),
    phone: z.string().max(20).optional(),
    pin: z
        .string()
        .regex(/^\d{4,6}$/, 'PIN must be 4-6 digits')
        .optional(),
    roleName: z.string().max(50).optional(),
});

// ID parameter schema
const idParamSchema = z.object({
    id: z.string().min(1, 'ID is required'),
});

// =============================================================================
// VALIDATION MIDDLEWARE FACTORY
// =============================================================================

/**
 * Creates a validation middleware for request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateBody = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const errors = result.error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid request data', errors);
        }
        req.validatedBody = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

/**
 * Creates a validation middleware for query parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateQuery = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            const errors = result.error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid query parameters', errors);
        }
        req.validatedQuery = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

/**
 * Creates a validation middleware for route parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 */
const validateParams = (schema) => (req, _res, next) => {
    try {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            const errors = result.error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            throw new ValidationError('Invalid route parameters', errors);
        }
        req.validatedParams = result.data;
        next();
    } catch (e) {
        next(e);
    }
};

module.exports = {
    // Schemas
    loginSchema,
    paymentSubmissionSchema,
    createInvoiceSchema,
    planChangeSchema,
    createTenantSchema,
    createStaffSchema,
    idParamSchema,

    // Middleware factories
    validateBody,
    validateQuery,
    validateParams,

    // Pre-built validators
    validateLogin: validateBody(loginSchema),
    validatePaymentSubmission: validateBody(paymentSubmissionSchema),
    validateCreateInvoice: validateBody(createInvoiceSchema),
    validatePlanChange: validateBody(planChangeSchema),
    validateCreateTenant: validateBody(createTenantSchema),
    validateCreateStaff: validateBody(createStaffSchema),
    validateIdParam: validateParams(idParamSchema),
};
