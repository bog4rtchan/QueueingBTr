# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Run: `node server.js` (env: `PORT`, default 3000; `HOST`, default `127.0.0.1`, set `0.0.0.0` for LAN/TV access; `CONTROL_PASSWORD`, required for `/action` whenever HOST is not localhost — without it a public server rejects all actions)
- Deploy: Render free web service (`node server.js`). `RENDER` (set by Render) makes HOST default to `0.0.0.0`. When `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, state is stored in Upstash Redis (key `queue-state`, via `fetch` to the REST API, no SDK) instead of `state.json`; a failed load exits the process rather than starting empty.
- Test: `node test.js` (plain `node:assert` script covering `queue.js`; no test runner, no single-test selection)

Node 18+, zero dependencies, no build step. `package.json` exists only so hosts detect a Node app (`npm start`); keep it dependency-free.

## Architecture

Two-queue ticket system (A = ATAP Issuance, C = CL Issuance). A PC runs `control.html`; a TV shows `display.html`.

- `queue.js` — pure reducer `apply(state, {queue, type})` returning new state; throws on bad input (server maps that to 400). State per queue is `{issued, serving, calls, skipped}`; `skipped` may be missing in old `state.json`, so read it as `?? []`. `view(state)` adds a derived `waiting` list (unserved, unskipped numbers); `/state` and `/action` return that view, and pages use `waiting` instead of computing it. Ticket labels (A7, C12) are derived from these counters, not stored.
- `server.js` — plain `node:http`. `GET /state`, `POST /action` (body `{queue, type}`, type ∈ add/next/recall/reset/skip; skip also needs `number` and toggles it), everything else is static from `public/` (path-traversal guarded). `/action` checks the `X-Control-Password` header against `CONTROL_PASSWORD`; the control page stores it in localStorage and shows an unlock bar on 401. `/state` and the display stay public. State is loaded once before `listen` and saved after every action (`state.json` locally, Upstash in the cloud); saves are chained so they land in order, and a failed save is logged, not fatal.
- `public/control.html` — sends actions only (no audio).
- `public/display.html` — polls `/state` every 1s and **plays the audio**. It detects a new call by `calls` changing (which is why `recall` bumps `calls` without changing `serving`), then slides the number in and announces it. Browsers block autoplay, so the page starts behind a full-screen "Turn on sound" button; that click unlocks audio for the page. Announcements are chained clips read digit by digit: `chime → Now Serving → Authority to Accept Payment|Confirmation Letter → A|C → digits`, loaded from `public/audio/<name>.wav` (names have spaces and capitals, matching the user's recordings; ATAP = Authority to Accept Payment, CL = Confirmation Letter). Missing clips are skipped and reported in the page.
- `public/style.css` — shared colour/font tokens for both pages. Each queue has one colour (`.lane-A` blue, `.lane-C` marigold) used on both screens. Fonts are self-hosted in `public/fonts/` so the system works offline; don't switch to a font CDN.


`state.json` is runtime data, not config.
