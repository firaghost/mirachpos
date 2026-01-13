const fetch = require('node-fetch');

async function test() {
    const url = 'http://127.0.0.1:3001/api/manager/overview?range=Daily:1&branchId=some_branch';
    const res = await fetch(url, {
        headers: {
            'X-Tenant': 'some_tenant',
            'Authorization': 'Bearer some_token' // This will fail auth but let's see which middleware hits first
        }
    });
    console.log('Status:', res.status);
    const json = await res.json().catch(() => null);
    console.log('Body:', json);
}

test();
