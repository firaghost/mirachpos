const { initDb } = require('./src/db');
const { getProductPerformance } = require('./src/services/reportAggregationService');

async function test() {
  await initDb();
  const res = await getProductPerformance({ tenantId: 't_test', fromDate: '2020-01-01', toDate: '2030-01-01', limit: 10 });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
test().catch(console.error);
