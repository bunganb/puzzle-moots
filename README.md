# Rangkai

A collaborative jigsaw game for the browser. The static site runs on Vercel; Supabase handles guest sign-in, photos, puzzle state, and live multiplayer.

## Features

- Turn one of three included pictures or your own JPG, PNG, or WEBP photo into a puzzle.
- Choose roughly 24, 48, 96, or 150 pieces. The exact count follows the picture's aspect ratio.
- Share a room link. Friends join with a name, no email account needed.
- See named cursors and dragged pieces move live. Cursor motion is smoothed between updates.
- Pieces start around the center board on a full-screen wooden table. The finished picture is available from the Picture button.
- Piece placement is saved in the database. Piece locks prevent two players from moving the same piece at once.
- Pan and zoom with a mouse or touch.

## Run locally

Without Supabase, the app runs in **local demo mode**. Rooms are saved in your browser; open two tabs to try cursor and piece syncing.

```sh
npm run dev
```

Open `http://localhost:3000`. There are no npm packages to install.

## Set up online multiplayer

1. Create a Supabase Free project.
2. Under **Authentication → Providers**, enable **Anonymous Sign-Ins**.
3. Under **Realtime → Settings**, disable **Allow public access** so private room channels use the access policies in the schema.
4. Run all of [`supabase/schema.sql`](supabase/schema.sql) in the **SQL Editor**. If you ran an older version before, run this file again to update the room creation function.
5. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. This is the public browser key. **Never use a service role key here.**
6. Restart `npm run dev`. The connection badge will switch from local demo to the live connection status.

For a public site, consider enabling CAPTCHA or Turnstile for anonymous sign-in in Supabase. Room links use random UUIDs; anyone with a link can join. Photos live in a private bucket and signed download links last one hour.

## Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` under **Project Settings → Environment Variables** for Production and Preview.
3. `vercel.json` already sets the build command to `npm run build` and the output directory to `dist`.
4. Deploy, then create a room and test its link on another browser or device.

The build can complete without Supabase variables, but the deployed site will then run in local demo mode. Cross-device multiplayer requires Supabase configuration.

Vercel Hobby is meant for personal, noncommercial projects. Supabase Free has Realtime message limits; the app sends cursor updates about 4–10 times per second per player depending on room size, and animates motion in the browser between them.

## Project files

- `public/app.js`: UI, rooms, photo upload, and coordination.
- `public/game.js`: board and piece drawing, drag and snap, zoom, and cursor animation.
- `public/game.css`: full-screen puzzle table layout.
- `public/supabase.js`: Supabase API, anonymous sign-in, Realtime, and local demo.
- `supabase/schema.sql`: database and access policies.
- `scripts/build.mjs`: creates the static site in `dist` with public configuration.

## Current limits

- Pieces snap into the center board. Free rotation and joining groups of pieces are not included yet.
- Local demo syncs only between tabs on the same browser and origin. Cross-device play requires Supabase.
- Custom photos in local demo are stored in localStorage; clearing browser data can remove old rooms.
