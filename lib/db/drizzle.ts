import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

// Configure postgres.js connection options
const connectionOptions = {
  max: 20, // Default is 10. Increased as a starting point.
  idle_timeout: 20, // Optional: seconds before an idle connection is closed
  connect_timeout: 30, // Optional: seconds to wait for connection
  // For other options, see: https://github.com/porsager/postgres#options
};

// It's good practice to only create one 'postgres' instance for your app
export const client = postgres(process.env.POSTGRES_URL, connectionOptions);
export const db = drizzle(client, { schema });
