# Acme Data Room API

Hono API designed for deployment on Render. It uses Supabase Postgres for metadata and a private `data-room-files` Storage bucket for document bytes.

## Setup

1. Create a Supabase project and enable Email and/or Google sign-in.
2. Copy `.env.example` to `.env`, add `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY`, then run `npm install` and `npm run dev`. The older `SUPABASE_SERVICE_ROLE_KEY` is also accepted for existing deployments.
3. Run `npm run supabase:login`, `npm run supabase:link`, then `npm run db:push`. This applies the baseline migration and creates the private `data-room-files` bucket.

## Render

Create a Web Service from this directory with build command `npm install && npm run build` and start command `npm start`. Add the variables from `.env.example`; Render injects `PORT` automatically.

## Database workflow

- [`supabase/schema.sql`](./supabase/schema.sql) is the **single source of truth**. Edit this file for every table, enum, index, policy, function, or bucket change.
- `npm run schema:migration -- add_folder_audit` generates a timestamped incremental migration from the changes in `schema.sql`. Review the generated SQL before continuing.
- `npm run schema:verify` resets a local Supabase database and reapplies the migration chain. It never targets the linked production project unless an explicit remote flag is added.
- `npm run db:push` applies outstanding migrations to the linked Supabase project; use this to update tables.
- `npm run db:pull` imports changes made in the dashboard into a migration (review it before committing).
- `npm run db:reset` resets only a **local** Supabase development database.
- `npm run db:repair:initial` marks the baseline as applied **only when** you already ran the initial schema manually; do not run it for a new Supabase project.
- `npm run db:types` prints current public-schema TypeScript types for a linked project.

## Design notes

The browser authenticates with Supabase; every protected API request brings its access token. The API validates that token and uses a service-role client only after authorization succeeds. Folder/file names are unique per parent, and all mutations check ownership.

## Data model and scaling

`data_rooms` owns a tree of `folders`; `files` belong to both a room and a nullable folder; `shares` points polymorphically at a room, folder, or file. `folder_totals()` recursively walks a subtree and returns aggregate count and size. At scale, maintain those totals in a materialized table/counter cache updated by a queue or trigger rather than recursively computing them on every view.

For 100,000 files, list only direct children with cursor pagination (`created_at, id` or `name, id`), keep the composite folder/name indexes in the schema, fetch counts independently, and avoid recursive listing except on explicit search/export. Full text search can move to Postgres FTS or a search service. Roles add a `role` column to `shares` (e.g. viewer/editor); the target model and permissions evaluation remain unchanged.

## AI note

AI was used as a coding assistant for project scaffolding, API implementation, UI copy, and documentation. The architectural choices, integration boundaries, and final verification remain reviewable in this repository.
