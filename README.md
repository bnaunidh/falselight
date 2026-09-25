# FALSE LIGHT

A first-person horror game. It's 1983, fire season, at a Forest Service lookout tower in the Pacific Northwest. Keep the light,
walk the lost out, report the fires, and don't look at the man by the creek. Not with the glasses. Not in a picture.

## Play
**Online:** https://bnaunidh.github.io/falselight/ (desktop Chrome, Edge or Safari; about 165 MB on first load).

Double-click **`Play FALSE LIGHT.command`** (it starts a tiny local server and opens your browser). Click the page to take control.
**Sound starts OFF.** Turn it on in Settings when you're somewhere you can use headphones.

| Key | | Key | |
|---|---|---|---|
| WASD / Shift | walk / jog | E | use |
| Mouse | look | F | step back from the searchlight / camera flash |
| Space (hold) | flash the searchlight (Morse) | C | raise the camera · click to shoot |
| B (hold) | binoculars | L | flashlight |
| Tab | logbook (tasks, rules, logs, photos) | M | trail map |
| Q | shake a print / turn it face-down | T (hold) | watch |
| Esc | back / pause | | |

This build is **Day 1 → Night 1 → Day 2 → Night 2**. Nights 3–7 come later (see `MASTER_PROMPT.md`).

## Build / develop
- Game code: `src/engine/*` (renderer, world, player, lights, audio, photo), `src/game/*` (rules + `bridge.js` script), `src/ui/*`.
- Art: Blender scripts in `~/Downloads/Blender Projects/false-light/src/` → exports → `python3 tools/import_assets.py` copies them into `assets/`.
- Dev server: `bash tools/sync.sh`, then the "falselight" launch config (serves `/tmp/false-light` on :8867).
  Test URLs: `?skip=night1&h=22.5&q=low&mute=1`. In the console: `__fl.test()`, `__fl.game.skipTo('day2')`, `__fl.shot('name')`.
- Credits: see `CREDITS.md` (all CC0 third-party assets, Poly Haven + Blender Studio).
