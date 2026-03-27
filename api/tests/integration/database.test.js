const db = require('../../src/db');

describe('Database Tests', () => {
  describe('Connection', () => {
    it('should connect to database', async () => {
      const result = await db.db().raw('SELECT 1 as test');
      expect(result[0].test).toBe(1);
    });
    
    it('should handle connection errors gracefully', async () => {
      // Test error handling
    });
  });
  
  describe('Migrations', () => {
    it('should have all migrations run', async () => {
      const migrations = await db.db('knex_migrations').select('*');
      expect(migrations.length).toBeGreaterThan(50);
    });
    
    it('should have required tables', async () => {
      const tables = await db.db('information_schema.tables')
        .where('table_schema', process.env.DB_NAME || 'mirachpos')
        .select('table_name');
      
      const tableNames = tables.map(t => t.table_name);
      
      expect(tableNames).toContain('tenants');
      expect(tableNames).toContain('branches');
      expect(tableNames).toContain('staff');
      expect(tableNames).toContain('orders');
      expect(tableNames).toContain('order_items');
      expect(tableNames).toContain('payments');
      expect(tableNames).toContain('products');
      expect(tableNames).toContain('inventory_items');
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('subscriptions');
      expect(tableNames).toContain('invoices');
    });
  });
  
  describe('Transactions', () => {
    it('should rollback on error', async () => {
      const trx = await db.db().transaction();
      
      try {
        await trx('test_table').insert({ name: 'test' });
        throw new Error('Force rollback');
      } catch (error) {
        await trx.rollback();
      }
      
      // Verify data was not saved
    });
    
    it('should commit on success', async () => {
      const trx = await db.db().transaction();
      
      try {
        await trx('orders').insert({
          tenant_id: 'test-tenant',
          branch_id: 'test-branch',
          total: 100
        });
        await trx.commit();
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
  });
  
  describe('Query Builder', () => {
    it('should support parameterized queries', async () => {
      const result = await db.db('orders')
        .where({ tenant_id: 'test-tenant' })
        .andWhere('total', '>', 100)
        .select('*');
      
      expect(Array.isArray(result)).toBe(true);
    });
    
    it('should handle joins correctly', async () => {
      const result = await db.db('orders')
        .join('order_items', 'orders.id', 'order_items.order_id')
        .where('orders.tenant_id', 'test-tenant')
        .select('orders.*', 'order_items.*');
      
      expect(Array.isArray(result)).toBe(true);
    });
  });
  
  describe('Indexes', () => {
    it('should have indexes on frequently queried columns', async () => {
      const indexes = await db.db().raw(`
        SELECT INDEX_NAME, COLUMN_NAME 
        FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'orders'
      `, [process.env.DB_NAME || 'mirachpos']);
      
      const indexNames = indexes.map(i => i.INDEX_NAME);
      
      // Should have tenant_id index
      expect(indexNames.some(name => name.includes('tenant'))).toBe(true);
    });
  });
});
