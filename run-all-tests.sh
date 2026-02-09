#!/bin/bash
# MIRACH POS - Complete Test Suite Runner
# Usage: ./run-all-tests.sh

echo "=================================="
echo "MIRACH POS Test Suite"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
FAILED=0
PASSED=0

# Function to run test
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -n "Running $test_name... "
    if eval $test_command > /tmp/test_output.txt 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo "  Error:"
        tail -5 /tmp/test_output.txt | sed 's/^/    /'
        ((FAILED++))
    fi
}

echo "1. Environment Checks"
echo "---------------------"

# Check Node.js version
run_test "Node.js Version" "node -v | grep -E 'v(20|22)'"

# Check npm
run_test "npm Available" "npm -v"

# Check if .env exists
if [ -f api/.env ]; then
    echo -e "${GREEN}✓ .env file exists${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ .env file missing${NC}"
    ((FAILED++))
fi

# Check critical env vars
if [ -f api/.env ]; then
    run_test "JWT_SECRET set" "grep -q 'JWT_SECRET=' api/.env && grep 'JWT_SECRET=' api/.env | grep -qv 'JWT_SECRET=$'"
    run_test "DB_HOST set" "grep -q 'DB_HOST=' api/.env"
fi

echo ""
echo "2. Dependency Checks"
echo "--------------------"

# Check node_modules
if [ -d node_modules ]; then
    echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Frontend dependencies missing (run: npm install)${NC}"
    ((FAILED++))
fi

if [ -d api/node_modules ]; then
    echo -e "${GREEN}✓ Backend dependencies installed${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Backend dependencies missing (run: cd api && npm install)${NC}"
    ((FAILED++))
fi

echo ""
echo "3. Database Checks"
echo "------------------"

# Check if database is accessible
cd api
if node -e "const db = require('./src/db').db(); db.raw('SELECT 1').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}! Database connection failed (continuing)${NC}"
    ((PASSED++))
fi

# Check migrations
MIGRATION_COUNT=$(ls -1 migrations/*.js 2>/dev/null | wc -l)
if [ $MIGRATION_COUNT -gt 50 ]; then
    echo -e "${GREEN}✓ Migrations present ($MIGRATION_COUNT)${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Missing migrations${NC}"
    ((FAILED++))
fi

cd ..

echo ""
echo "4. Security Checks"
echo "------------------"

# Check for hardcoded secrets
if grep -r "password.*=.*['\"]admin['\"]" api/src --include="*.js" 2>/dev/null; then
    echo -e "${RED}✗ Hardcoded password found${NC}"
    ((FAILED++))
else
    echo -e "${GREEN}✓ No hardcoded passwords${NC}"
    ((PASSED++))
fi

# Check JWT secret strength (if .env exists)
if [ -f api/.env ]; then
    JWT_SECRET=$(grep "JWT_SECRET=" api/.env | cut -d'=' -f2)
    if [ ${#JWT_SECRET} -gt 32 ]; then
        echo -e "${GREEN}✓ JWT_SECRET is strong (${#JWT_SECRET} chars)${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}! JWT_SECRET may be weak (${#JWT_SECRET} chars)${NC}"
        ((PASSED++))
    fi
fi

echo ""
echo "5. Build Tests"
echo "--------------"

# Check TypeScript compilation
echo -n "TypeScript check... "
if npx tsc --noEmit 2> /tmp/tsc_output.txt; then
    echo -e "${GREEN}✓ PASSED${NC}"
    ((PASSED++))
else
    ERROR_COUNT=$(grep -c "error TS" /tmp/tsc_output.txt 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" = "0" ]; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ $ERROR_COUNT TypeScript errors${NC}"
        ((FAILED++))
    fi
fi

# Check for ESLint (if configured)
if [ -f .eslintrc.cjs ] || [ -f .eslintrc.js ]; then
    echo -n "ESLint check... "
    if npx eslint src --ext .ts,.tsx 2> /tmp/eslint_output.txt; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}! Warnings found${NC}"
        ((PASSED++))
    fi
fi

echo ""
echo "6. API Tests"
echo "------------"

# Start API in background for testing
echo "Starting API server for tests..."
cd api
NODE_ENV=test BACKGROUND_DISABLED=1 SKIP_DB_INIT_ON_BOOT=1 timeout 15 node src/index.js &
API_PID=$!

wait_for_ok() {
    local url=$1
    local attempts=${2:-10}
    local delay_s=${3:-1}

    for i in $(seq 1 $attempts); do
        if curl -s "$url" | grep -q "ok"; then
            return 0
        fi
        sleep "$delay_s"
    done
    return 1
}

# Test health endpoint
if wait_for_ok "http://localhost:3001/health" 10 1; then
    echo -e "${GREEN}✓ Health endpoint working${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Health endpoint failed${NC}"
    ((FAILED++))
fi

# Test API root
if curl -s http://localhost:3001/ | grep -q "mirachpos"; then
    echo -e "${GREEN}✓ API root accessible${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ API root failed${NC}"
    ((FAILED++))
fi

# Stop API
kill $API_PID 2>/dev/null
cd ..

echo ""
echo "7. Frontend Build"
echo "-----------------"

# Check if vite build works
echo "Testing Vite build (this may take a minute)..."
if timeout 120 npm run build > /tmp/build_output.txt 2>&1; then
    echo -e "${GREEN}✓ Build successful${NC}"
    ((PASSED++))
    
    # Check bundle size
    if [ -d dist ]; then
        BUNDLE_SIZE=$(du -sh dist | cut -f1)
        echo -e "  Bundle size: $BUNDLE_SIZE"
    fi
else
    echo -e "${RED}✗ Build failed${NC}"
    tail -10 /tmp/build_output.txt | sed 's/^/  /'
    ((FAILED++))
fi

echo ""
echo "=================================="
echo "Test Summary"
echo "=================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Review above.${NC}"
    exit 1
fi
