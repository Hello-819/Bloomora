# Bloomora V2

Bloomora is a study tracker with timers, labels, tasks, notes, a built-in study assistant, stats, Island/Garden progression, quests, achievements, backup import/export, ambient sound, LoFi music, and optional Supabase sync.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Data model

- V2 stores app data in IndexedDB through Dexie under the `bloomora_v2` database.
- On first load, it reads the old `localStorage` key `bloomora_v1` and migrates it into V2.
- The old `bloomora_v1` key is not deleted or overwritten, so rollback is possible.
- JSON export/import is versioned and validates a backup before replacing local data.

## Optional Supabase sync

Bloomora works without an account. To enable optional sync, copy `.env.example` to `.env.local` and add:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Run `supabase_schema_v2.sql` in the Supabase SQL editor. The schema uses dedicated `bloomora_*` table names and row-level security so users can only read and write their own rows.

If you previously used the older Bloomora SQL, rerun the current `supabase_schema_v2.sql`. V2 intentionally syncs to `bloomora_profile_states`, `bloomora_labels`, `bloomora_tasks`, `bloomora_notes`, and `bloomora_sessions` to avoid collisions with old tables.

The AI chatbot uses a dev-server API route at `/api/ai-chat` so the OpenRouter key stays server-side in `.env.local`. Do not rename it to `VITE_OPENROUTER_API_KEY`, because `VITE_*` variables are exposed to browser code.

## Scripts

```bash
npm run dev
npm run build
npm run test
npm run test:e2e
```

Playwright may need browser binaries installed separately:

```bash
npx playwright install
```
