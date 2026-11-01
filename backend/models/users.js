'use strict';
// "Users" are anonymous browsers: one row per client id (a UUID the browser generates and keeps in localStorage).
const db = require('../config/db');

async function findOrCreateByClientId(clientId) {
  return (await db.query(
    `INSERT INTO users(client_id) VALUES($1)
     ON CONFLICT (client_id) DO UPDATE SET client_id=EXCLUDED.client_id
     RETURNING id, client_id, created_at`, [clientId])).rows[0];
}

module.exports = { findOrCreateByClientId };
