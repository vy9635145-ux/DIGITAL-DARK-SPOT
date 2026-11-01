'use strict';
const db = require('../config/db');
const { SETTING_DEFAULTS } = require('../utils/constants');

async function getAll(userId) {
  const r = await db.query('SELECT key, value FROM user_settings WHERE user_id=$1', [userId]);
  const out = { ...SETTING_DEFAULTS };
  for (const row of r.rows) if (Object.hasOwn(SETTING_DEFAULTS, row.key)) out[row.key] = row.value;
  return out;
}

async function setMany(userId, values) {
  for (const [key, value] of Object.entries(values)) {
    await db.query(
      `INSERT INTO user_settings(user_id,key,value) VALUES($1,$2,$3::jsonb)
       ON CONFLICT (user_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [userId, key, JSON.stringify(value)]);
  }
}

module.exports = { getAll, setMany };
