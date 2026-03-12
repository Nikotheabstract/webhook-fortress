import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const client = {
  query: (text: string, params?: unknown[]) => pool.query(text, params),
};
