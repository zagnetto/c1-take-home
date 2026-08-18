import mysql from 'mysql2/promise';
import { config } from '../config.ts';

export const pool = mysql.createPool(config.mysqlUrl);

export async function waitForMysql(retries = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`mysql not reachable: ${lastErr}`);
}
