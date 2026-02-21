# Bloomora (local-only study tracker)

A single-page, **local-first** study timer + stats dashboard with gamified progress.

## Gamification (synced progress)

Every time you **End & Save** a study session, the app adds that time to **both**:

- **Island**: levels up every **5 hours** of total study time (more levels unlock more upgrades).
- **Garden**: grows from **Seed → Sprout → Plant → Sapling → Tree** (tree at **2 hours**), then generates fruit over time that you can harvest into your collection.

You can switch between Island / Garden pages at any time — your progress is always kept in sync.

## Music + background sounds

- Ambient background sounds: **Fire / Wind / Sea / Nature**
- LoFi Girl playlist: embedded YouTube stream (open via the **music** button)

## Run locally

1. Download the folder.
2. Open `index.html` in your browser.

> Tip: Some browsers may block certain features (like file import/export or YouTube embeds) when opening an HTML file directly. If that happens, run a tiny local server:

```bash
# from the bloomora folder
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Data storage

Everything is stored **locally in your browser** via `localStorage` under the key `bloomora_v1`.

- Export/Import uses a JSON backup file.
- Reset clears the localStorage key.
