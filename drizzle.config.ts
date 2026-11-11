// Drizzle Kit configuration (development tooling only -- NOT bundled into the Electron app).
//
// supabase/schema.sql is the source of truth: it holds enums, RLS policies, RPC functions,
// triggers and views that Drizzle's schema DSL cannot express. Drizzle is therefore used in
// introspection mode to mirror the live database into typed TypeScript:
//
//   npm run db:pull      -> writes ./drizzle/schema.ts and ./drizzle/relations.ts
//   npm run db:studio    -> browse the data in Drizzle Studio
//
// Do NOT run `drizzle-kit push` / `migrate` against this project: they would try to diff
// against a schema.ts and could drop policies or functions defined in schema.sql.
//
// Credentials live in .env.drizzle (gitignored, never packaged). Use the Supabase
// "Direct connection" or "Session pooler" string -- not the anon key, and never in .env,
// because .env is bundled into the desktop installer.
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.drizzle' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing. Copy .env.drizzle.example to .env.drizzle and fill it in.');
}

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schemaFilter: ['public'],              // ignore auth, storage, realtime, ...
  entities: { roles: { provider: 'supabase' } },  // skip Supabase-managed roles when pulling
  introspect: { casing: 'preserve' },    // keep snake_case names identical to the SQL schema
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
});
