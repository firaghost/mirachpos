# AI-Powered POS System Code Analysis & Security Testing Prompt

## Context
You are an expert security architect, code reviewer, and POS systems specialist. You have been tasked with analyzing a custom-built POS (Point of Sale) system codebase before production deployment. This system handles payment processing, inventory management, order management, and sensitive financial transactions for restaurants/cafes.

**Critical Constraint**: This system will handle real customer payment data and financial transactions. Any vulnerabilities, inconsistencies, or production-grade deficiencies could result in:
- Data breaches and PCI DSS violations
- Financial losses from duplicate/failed transactions
- Compliance penalties and legal liability
- Reputational damage

---

## Phase 1: Code Analysis & Discovery

### Task 1.1: Codebase Structure Analysis
Analyze the provided codebase and provide a **structured inventory** of:

1. **Project Architecture**
   - Primary technology stack (languages, frameworks, databases)
   - Directory structure and naming conventions
   - Separation of concerns (modules, layers, microservices)
   - Design patterns used (MVC, MVVM, Clean Architecture, etc.)

2. **Core Components**
   - List all major modules/services with brief descriptions
   - Identify dependencies between modules
   - Map out API endpoints and their purposes
   - Database schema structure

3. **Data Flow Mapping**
   - Request flow from user action to database
   - Payment processing pipeline
   - Inventory synchronization flow
   - Order management workflow
   - Error handling and logging flow

4. **Configuration & Environment**
   - Environment variables used
   - Configuration files and their purposes
   - Secrets management approach
   - Database connection handling

### Task 1.2: Existing Implementation Audit
Document what currently exists:

1. **Authentication & Authorization**
   - Current login mechanism (session-based, JWT, OAuth?)
   - Password hashing algorithms and salt usage
   - Token generation and expiration logic
   - Role-based access control implementation
   - MFA/2FA support status

2. **Encryption & Data Protection**
   - Where is encryption implemented (transit, at-rest)?
   - Which encryption algorithms are used?
   - How are encryption keys managed?
   - Is tokenization implemented for payment data?
   - How is sensitive data logged?

3. **Payment Processing**
   - Payment gateway integration (which provider?)
   - How payment data flows through the system
   - Is idempotency implemented for duplicate prevention?
   - How are payment failures and retries handled?
   - Where is payment data stored (if at all)?

4. **Database Security**
   - Is SQL injection prevention implemented (parameterized queries)?
   - Are database credentials hardcoded or externalized?
   - Are ACID properties properly utilized?
   - Transaction handling for multi-step operations
   - Data validation at the database layer

5. **API Security**
   - API authentication mechanism (API keys, OAuth, JWT?)
   - Rate limiting implementation
   - Input validation on API endpoints
   - CORS configuration
   - API versioning strategy
   - Error handling and information disclosure

6. **Inventory Management**
   - Real-time inventory update mechanism
   - Handling of concurrent inventory updates
   - Overselling prevention logic
   - Multi-location inventory synchronization
   - Stock reservation system

---

## Phase 2: Vulnerability & Inconsistency Detection

### Task 2.1: Security Vulnerability Scan

Identify and categorize all security issues:

1. **Critical Vulnerabilities** (Block production deployment)
   - Hard-coded secrets (API keys, database passwords, tokens)
   - Raw credit card data storage (PCI violation)
   - Missing HTTPS/TLS enforcement
   - Unencrypted payment data transmission
   - SQL injection vulnerabilities
   - Broken authentication mechanisms
   - Missing CSRF protection
   - Hardcoded admin credentials

2. **High-Risk Issues** (Fix before production)
   - Weak encryption algorithms
   - Missing input validation
   - Insufficient rate limiting
   - Weak password policies
   - Missing multi-factor authentication
   - Improper error handling (exposing stack traces)
   - Missing audit logging
   - Insufficient access controls

3. **Medium-Risk Issues** (Plan for near-term fixes)
   - Missing API versioning
   - Incomplete logging (insufficient detail for debugging)
   - Missing health checks
   - No circuit breakers for external calls
   - Weak session management
   - Missing request timeouts

4. **Low-Risk Issues** (Backlog for continuous improvement)
   - Code documentation gaps
   - Inconsistent naming conventions
   - Missing unit tests
   - Performance optimization opportunities

### Task 2.2: Code Quality & Production-Readiness Issues

Evaluate against production standards:

1. **Data Integrity Issues**
   - Missing transaction handling for multi-step operations
   - Race conditions in concurrent access scenarios
   - Missing idempotency key implementation for payments
   - Lack of database constraint validation
   - Inconsistent state management

2. **Error Handling & Resilience**
   - Missing try-catch blocks
   - Unhandled exceptions
   - Missing fallback mechanisms
   - No circuit breaker pattern for external APIs
   - Missing retry logic with exponential backoff
   - Inadequate logging for debugging

3. **Performance Issues**
   - Missing database indexes
   - N+1 query problems
   - Inefficient loops or data structures
   - Missing caching strategies
   - Synchronous operations that should be async

4. **Architectural Issues**
   - Tight coupling between modules
   - Missing dependency injection
   - Hardcoded configuration values
   - Missing API gateway pattern
   - Insufficient separation of concerns

5. **Documentation Gaps**
   - Missing API documentation
   - Undocumented configuration options
   - Missing deployment instructions
   - Unclear business logic in critical sections
   - No architecture decision records (ADRs)

### Task 2.3: Inventory Analysis

Create an inventory of issues found:

**Output Format**:
```
ISSUE ID: [SEVERITY]_[NUMBER]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
Location: [File/Module Path]
Component: [Affected Component]
Issue Type: [Security|DataIntegrity|Performance|CodeQuality|Documentation]
Description: [Clear explanation of the issue]
Impact: [Business and technical impact]
Evidence/Location: [Code snippet or specific line references]
Reproduction Steps: [How to verify the issue, if applicable]
```

---

## Phase 3: Issue Prioritization & Risk Assessment

### Task 3.1: Risk Matrix
Create a risk matrix scoring issues by:
- **Likelihood**: How likely is this to cause problems?
- **Impact**: How severe would the consequences be?
- **Exploitability**: How easily can this be exploited?
- **Detection**: How likely is this to be caught in testing?

Assign an overall **Risk Score** (1-10) and **Priority** (P0/P1/P2/P3)

### Task 3.2: Dependency Analysis
Identify:
- Outdated or vulnerable dependencies
- Missing security patches
- License compliance issues
- Supply chain risks

---

## Phase 4: Patch & Fix Generation

### Task 4.1: Create Fix Plan for Critical Issues

For each CRITICAL issue, provide:

1. **Current Code (Vulnerable)**
   ```
   [Show the problematic code snippet]
   ```

2. **Fixed Code**
   ```
   [Provide the secure, production-ready code]
   ```

3. **Explanation**
   - Why this is a vulnerability
   - How the fix addresses it
   - Compliance standards it addresses (e.g., PCI DSS 4.0)

4. **Testing Approach**
   - How to verify the fix works
   - Security test cases to add

5. **Deployment Notes**
   - Any data migrations needed
   - Backward compatibility concerns
   - Configuration changes required

### Task 4.2: Implementation Checklist for Fixes

Provide step-by-step implementation guidance:
- [ ] Code changes required
- [ ] Configuration updates
- [ ] Database migrations
- [ ] Secrets rotation
- [ ] Testing procedures
- [ ] Deployment steps
- [ ] Rollback procedure

---

## Phase 5: Production Readiness Verification

### Task 5.1: Post-Fix Validation Checklist

Verify all fixes are properly implemented:

- [ ] No hard-coded secrets remain
- [ ] All encryption uses industry-standard algorithms (AES-256, TLS 1.2+)
- [ ] Input validation on all user-facing inputs
- [ ] ACID properties properly used in database transactions
- [ ] Idempotency keys implemented for all payment operations
- [ ] Rate limiting configured on all API endpoints
- [ ] Error messages don't expose internal details
- [ ] Audit logging captures all financial transactions
- [ ] Database credentials never logged
- [ ] API endpoints properly authenticated
- [ ] CORS configuration is restrictive
- [ ] Dependencies are up-to-date
- [ ] Security headers configured (HSTS, CSP, X-Frame-Options)
- [ ] Database connection uses SSL/TLS
- [ ] Session handling is secure (HttpOnly, Secure cookies)
- [ ] Payment data never stored in logs
- [ ] Multi-location inventory sync handles conflicts
- [ ] Failed payment retries prevent duplicate charges
- [ ] Concurrent transaction handling prevents race conditions

### Task 5.2: Security Testing Recommendations

Suggest specific tests to verify security:

1. **Penetration Testing Scenarios**
   - SQL injection attempts on all API endpoints
   - Authentication bypass attempts
   - Authorization bypass (privilege escalation)
   - Payment processing attacks (duplicate charges, amount tampering)
   - Inventory manipulation attempts

2. **Integration Testing**
   - Payment gateway integration under various failure scenarios
   - Inventory synchronization across multiple locations
   - Concurrent transaction handling
   - Network failure recovery
   - Database transaction rollbacks

3. **Load Testing**
   - Concurrent payment processing (peak hour simulation)
   - Inventory update throughput
   - Database query performance
   - API response time under load

4. **Data Security Testing**
   - Encryption key rotation
   - Secrets management verification
   - Audit log integrity
   - Data retention policy compliance

---

## Phase 6: Compliance Verification

### Task 6.1: PCI DSS 4.0 Compliance Checklist

Verify compliance with:
- Requirement 3.5.1: Disk/partition-level encryption for cardholder data
- End-to-end encryption for all cardholder data in transit
- Strong cryptography (AES-256 minimum)
- Secure key management and rotation
- No logging of sensitive cardholder data
- Tokenization implementation
- Point-to-point encryption (P2PE) where applicable

### Task 6.2: GDPR/Privacy Compliance

If applicable:
- Personal data protection mechanisms
- Right to deletion implementation
- Data retention policies
- Privacy impact assessment
- Consent management

---

## Phase 7: Documentation & Handover

### Task 7.1: Security Architecture Document

Create or update:
1. **Threat Model** (STRIDE methodology)
   - What can be threatened?
   - Who are the threat actors?
   - What are the attack vectors?

2. **Security Architecture Diagram**
   - Data flow between components
   - Trust boundaries
   - Encryption points
   - Authentication checkpoints

3. **Operational Security Guide**
   - How to securely deploy
   - How to monitor for security issues
   - Incident response procedures
   - Key rotation procedures

### Task 7.2: Implementation Summary Report

Final comprehensive report including:

**Executive Summary**
- Overall security posture assessment
- Critical findings summary
- Risk score overview
- Recommendation for production readiness

**Detailed Findings**
- All issues organized by severity and category
- Fix status for each issue
- Verification test results

**Deployment Checklist**
- Pre-production verification steps
- Monitoring setup requirements
- Incident response readiness

**Ongoing Recommendations**
- Security monitoring setup
- Vulnerability scanning schedule
- Dependency update strategy
- Code review practices

---

## Execution Instructions

1. **Analyze the codebase**: Run through Phases 1-2 systematically
2. **Generate inventory**: Create comprehensive list of all issues found (Phase 3)
3. **Create fixes**: For each issue, provide code patches (Phase 4)
4. **Verify production readiness**: Complete all checklists (Phase 5)
5. **Ensure compliance**: Verify PCI DSS and other standards (Phase 6)
6. **Document everything**: Create architectural and operational docs (Phase 7)

---

## Output Format Requirements

Present findings in the following format:

```
# Code Analysis & Security Assessment Report

## Executive Summary
[Overall assessment and risk score]

## Phase 1: Code Structure Inventory
[Architecture, components, data flow]

## Phase 2: Vulnerabilities & Issues Found
[Comprehensive list of all issues with severity]

## Phase 3: Issue Prioritization
[Risk matrix and dependency analysis]

## Phase 4: Security Patches & Fixes
[Code corrections for each issue]

## Phase 5: Production Readiness Checklist
[Verification that all issues are fixed]

## Phase 6: PCI DSS Compliance Verification
[Compliance status for each requirement]

## Phase 7: Implementation Roadmap
[Steps to implement all fixes]

## Appendices
[Technical details, code snippets, architecture diagrams]
```

---

## Important Considerations

- **This is a payment system**: Security is not optional. All critical issues must be fixed before production.
- **PCI DSS 4.0**: New standards require disk-level encryption and stronger authentication.
- **Payment idempotency**: Critical to prevent duplicate charges from retries or network failures.
- **Data integrity**: ACID properties and concurrent access handling are essential.
- **Audit trail**: All financial transactions must be logged immutably for compliance.
- **Minimize exposure**: Payment data should flow through the system with minimal storage or logging.

**Begin analysis immediately upon code submission.**
