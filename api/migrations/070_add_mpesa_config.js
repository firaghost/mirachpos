exports.up = async (knex) => {
  const hasCol = await knex.schema.hasColumn('platform_payment_config', 'mpesa_config_json');
  if (!hasCol) {
    await knex.schema.table('platform_payment_config', (t) => {
      t.text('mpesa_config_json').nullable();
    });
    
    // Set default value for the row
    await knex('platform_payment_config').where({ id: 1 }).update({
      mpesa_config_json: JSON.stringify({ appId: '', appKey: '', shortCode: '', baseUrl: '', fabricAppId: '', appSecret: '', merchantAppId: '', merchantCode: '', privateKey: '', enabled: false, enabledForPos: false })
    });
  }
};

exports.down = async (knex) => {
  const hasCol = await knex.schema.hasColumn('platform_payment_config', 'mpesa_config_json');
  if (hasCol) {
    await knex.schema.table('platform_payment_config', (t) => {
      t.dropColumn('mpesa_config_json');
    });
  }
};
