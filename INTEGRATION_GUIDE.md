/**
 * INTEGRATION GUIDE: Subscription Enforcement
 * 
 * Apply these changes to your existing routes to enforce subscription limits
 */

// ============================================================================
// 1. Add to api/src/app.js
// ============================================================================

// Near other route imports, add:
const { makeSubscriptionStatusRouter } = require('./routes/subscriptionStatus');
const { cleanupDeviceSessions } = require('./middleware/deviceTracking');

// In route mounting section, add:
app.use('/api', makeSubscriptionStatusRouter());

// Start device cleanup interval (runs every 30 minutes)
setInterval(cleanupDeviceSessions, 30 * 60 * 1000);


// ============================================================================
// 2. Apply enforcement to existing routes (api/src/routes/)
// ============================================================================

// In manager.js - Staff management:
const { enforceStaffLimit } = require('../middleware/subscriptionEnforcement');
// Apply to POST /staff endpoint:
// router.post('/manager/staff', requireAuth, requireRole('manager'), enforceStaffLimit, async (req, res) => { ... });

// In manager.js - Table management:
const { enforceTableLimit } = require('../middleware/subscriptionEnforcement');
// Apply to POST /tables endpoint:
// router.post('/manager/tables', requireAuth, requireRole('manager'), enforceTableLimit, async (req, res) => { ... });

// In owner.js - Branch management:
const { enforceBranchLimit } = require('../middleware/subscriptionEnforcement');
// Apply to POST /owner/branches endpoint:
// router.post('/owner/branches', requireAuth, requireRole('owner'), enforceBranchLimit, async (req, res) => { ... });

// In pos.js - Device tracking:
const { trackDeviceSession } = require('../middleware/deviceTracking');
// Apply to all POS routes:
// router.use('/pos', requireAuth, trackDeviceSession);

// In manager.js - Inventory (Growth+ feature):
const { requireInventoryFeature } = require('../middleware/subscriptionEnforcement');
// Apply to inventory routes:
// router.get('/manager/inventory', requireAuth, requireInventoryFeature, async (req, res) => { ... });

// In pos.js - KDS (Growth+ feature):
const { requireKdsFeature } = require('../middleware/subscriptionEnforcement');
// Apply to KDS endpoints:
// router.get('/pos/kds', requireAuth, requireKdsFeature, async (req, res) => { ... });


// ============================================================================
// 3. Frontend integration (React)
// ============================================================================

// Create a hook to check subscription status:
/*
// hooks/useSubscription.ts
import { useState, useEffect } from 'react';

export function useSubscription() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/subscription/status')
      .then(r => r.json())
      .then(data => {
        setStatus(data);
        setLoading(false);
      });
  }, []);

  return { status, loading };
}
*/

// Show upgrade banner when near limits:
/*
function SubscriptionBanner() {
  const { status } = useSubscription();
  
  if (!status?.active) {
    return <div className="alert alert-danger">Subscribe to continue using MirachPOS</div>;
  }
  
  if (status.warnings?.length > 0) {
    return (
      <div className="alert alert-warning">
        {status.warnings.map(w => (
          <div key={w.resource}>{w.message}</div>
        ))}
        <a href="/billing">Upgrade plan</a>
      </div>
    );
  }
  
  return null;
}
*/


// ============================================================================
// 4. Database migration
// ============================================================================

// Run the migration:
// cd api && npx knex migrate:latest

// Or manually create the tables using the SQL in migrations/050_subscription_enforcement.js


// ============================================================================
// 5. Testing the enforcement
// ============================================================================

// Test device limit:
// 1. Subscribe to Starter plan (3 devices max)
// 2. Login from 3 different browsers/devices
// 3. Try to login from 4th device - should get 403 error

// Test feature gating:
// 1. Subscribe to Starter plan
// 2. Try to access Inventory - should get 403 "Upgrade to Growth"
// 3. Subscribe to Growth
// 4. Inventory should now work

// Test table limit:
// 1. Subscribe to Starter (5 tables max)
// 2. Create 5 tables
// 3. Try to create 6th table - should get 403 error
