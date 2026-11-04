# Queue Number System

A queuing system with two queues:

| Queue | Numbers |
|-------|---------|
| ATAP Issuance | A1, A2, A3 … |
| CL Issuance   | C1, C2, C3 … |

A **PC** runs the controls. A **Smart TV** shows the "Now Serving" screen. Each call is announced
with pre-recorded voice clips.

## Requirements

- Node.js 18 or newer (no `npm install` needed, it has no dependencies)

## Start

```bash
node server.js
```

- **Control (PC):** http://localhost:3000/control.html
- **Display (TV):** see below

Numbers are saved in `state.json`, so restarting the server keeps the queue.

## Showing the display on the TV

**Option 1: TV browser (Wi-Fi/LAN).** The PC and the TV must be on the same network.
The server only listens on localhost by default, so start it with `HOST=0.0.0.0 node server.js`
(Windows: `set HOST=0.0.0.0` then `node server.js`).
1. Find the PC's IP: `hostname -I` (Linux) or `ipconfig` (Windows), e.g. `10.10.8.48`.
2. On the TV browser open `http://10.10.8.48:3000/display.html`.
3. If it won't load, allow port 3000 through the PC firewall.

**Option 2: HDMI (default, localhost only).** Plug the PC into the TV as a
second screen, open `http://localhost:3000/display.html` on it, then click the page to go fullscreen.

## Controls (per queue)

Several control pages can be open at once (different PCs or tabs); each one shows the others' changes within about a second.

| Button | What it does |
|--------|--------------|
| **Issue A8** | Issues the next ticket. Tell or write it for the client. |
| **Counter 1 / 2 / 3** | Choose which counter the client goes to. Call stays disabled until one is chosen; the choice stays selected (remembered on that PC) until changed. |
| **Call A5 to Counter 2** | Calls the next waiting number to that counter. The TV shows the number and "Counter 2" and announces both. |
| **Repeat call** | Replays the voice for the current number. |
| **Add a number to the line** | For a missing stub: pick the number from the dropdown and press Add to line. A number lower than the one now serving goes first in line; any other number slots into number order. |
| **Missing stubs (settings)** | Per queue: mark numbers whose stub is lost or damaged. They are never issued or called (Issue jumps over them). The list stays after Start over; unmark a number when its stub is back. |
| **Waiting in line** | Click a number to skip it (client left); Call jumps over it and the TV stops listing it. Click it again to bring it back. |
| **TV voice: Woman / Man** | Picks the voice the TV announces with (Woman = Valkyrie, Man = Halliday). One setting for the whole office: changing it on one control panel changes it everywhere. |
| **History** | Link at the top of the control page (or `/history.html`). A separate page listing every Issue, Call (with counter), Repeat call, skip, add to line, missing stub and Start over, newest first, with the time and state. Updates on its own every 2 seconds. Filter by ATAP or CL. Keeps the last 2000 entries; Start over doesn't clear it. On Render without Upstash it's lost whenever the server restarts, like the queue. |
| **Start over at A1** | Starts the queue over from A1 / C1 after you confirm. Use at the start of the day. |

## Voice clips

The voice plays from the **display page** (the TV). Browsers only allow sound after a click, so the display
opens with a **Turn on sound** button: click it once (or press OK on the TV remote) each time the page is opened.
It also switches to fullscreen.

There are two voices, each in its own folder: `public/audio/Valkyrie/` (woman) and `public/audio/Halliday/` (man).
Each folder has the same WAV files, named exactly like this (`chime.wav` goes in `public/audio/` itself, shared by both):

| File | Says |
|------|------|
| `Now Serving.wav` | "Now serving" |
| `Authority to Accept Payment.wav` | the ATAP queue's name |
| `Confirmation Letter.wav` | the CL queue's name |
| `A.wav` | "A" |
| `C.wav` | "C" |
| `0.wav` … `9.wav` | "zero" … "nine" |
| `Counter1.wav` … `Counter3.wav` | "please proceed to counter 1" … "3" |
| `chime.wav` | optional "ding" before each call |

All of them are preloaded when the display page opens. Numbers are read digit by digit:

- A12 to counter 2 plays `Now Serving → Authority to Accept Payment → A → 1 → 2 → Counter2`
- C7 to counter 3 plays `Now Serving → Confirmation Letter → C → 7 → Counter3`

To change a recording, replace the file with one of the same name and refresh the display page.
If a clip is missing, it is skipped and the display page shows which file is missing.

## Deploy to the cloud (Render + Upstash, free tiers)

Render runs `server.js`; Upstash Redis keeps the queue numbers (Render's free disk is wiped on every restart).

1. **Upstash:** sign up at upstash.com, create a **Redis** database (free; pick a region near Render's, e.g. Singapore).
   On its page, under **REST API**, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. **Render:** sign up at render.com with GitHub, then **New → Web Service** and pick this repo.
   - Runtime: Node. Build command: `npm install`. Start command: `node server.js`. Instance type: **Free**.
   - **Environment variables:**
     - `CONTROL_PASSWORD`: a strong password (without it the buttons stay disabled)
     - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: from step 1
   - Create the service. Render gives you `https://<name>.onrender.com`.
3. Open `https://<name>.onrender.com/control.html` on the office PC and enter the password once (remembered on that PC).
   The TV opens `https://<name>.onrender.com/display.html` (no password, view only).

Every push to GitHub redeploys automatically; the numbers stay in Upstash.

Things to know:
- Free Render services **sleep after ~15 minutes with no visitors**. The open TV display keeps it awake, but the first
  load in the morning can take 30–60 seconds.
- If the Upstash keys are wrong, the server refuses to start (so it never overwrites the saved queue). Check Render's logs.
- The voice plays on the TV display page (click **Turn on sound** once after opening it). If the office internet goes down, the queue stops.

## Test

```bash
node test.js
```
