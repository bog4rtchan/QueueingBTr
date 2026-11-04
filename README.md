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

| Button | What it does |
|--------|--------------|
| **Issue A8** | Issues the next ticket. Tell or write it for the client. |
| **Call A5** | Calls the next waiting number, plays the voice, and updates the TV. |
| **Repeat call** | Replays the voice for the current number. |
| **Waiting in line** | Click a number to skip it (client left); Call jumps over it and the TV stops listing it. Click it again to bring it back. |
| **Start over at A1** | Starts the queue over from A1 / C1 after you confirm. Use at the start of the day. |

## Voice clips

The voice plays from the **PC** (TV browsers often block sound). With HDMI, the sound comes out
of the TV speakers.

The recordings live in `public/audio/` as WAV files, named exactly like this:

| File | Says |
|------|------|
| `Now Serving.wav` | "Now serving" |
| `Authority to Accept Payment.wav` | the ATAP queue's name |
| `Confirmation Letter.wav` | the CL queue's name |
| `A.wav` | "A" |
| `C.wav` | "C" |
| `0.wav` … `9.wav` | "zero" … "nine" |
| `chime.wav` | optional "ding" before each call |

All of them are preloaded when the control page opens. Numbers are read digit by digit:

- A12 plays `Now Serving → Authority to Accept Payment → A → 1 → 2`
- C7 plays `Now Serving → Confirmation Letter → C → 7`

To change a recording, replace the file with one of the same name and refresh the control page.
If a clip is missing, it is skipped and the control page shows which file is missing.

## Deploy to the cloud (Railway)

Railway runs `server.js` as-is and serves the pages, audio and numbers from one HTTPS address.

1. Create an account at railway.com.
2. Install the CLI (`npm i -g @railway/cli`), then in this folder:
   ```bash
   railway login
   railway init          # create a new project
   railway up            # upload and deploy this folder
   ```
3. In the Railway dashboard, open the service:
   - **Variables:** add `CONTROL_PASSWORD` with a strong password. Without it the buttons stay disabled.
   - **Volumes:** add a volume (any mount path, e.g. `/data`). The queue numbers are saved there so a redeploy doesn't reset them.
   - **Settings, Networking:** click **Generate Domain** to get the public address.
4. Open `https://<your-domain>/control.html` on the office PC and enter the password once (it's remembered on that PC).
   The TV opens `https://<your-domain>/display.html` (no password, view only).

The voice still plays from the control page's PC, so that PC needs speakers.
If the office internet goes down, the queue stops until it's back.

## Test

```bash
node test.js
```
