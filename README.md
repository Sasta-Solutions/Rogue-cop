# Hot Entry

A 3D top-down tactical hostage-rescue game. Open `index.html` in a browser (needs internet for three.js).

## Sound

- `audio/synth.js` builds every sound effect, ambience bed and music loop in code when the game loads, so the game has full sound with no files.
- `audio/bank.js` holds recorded sounds (empty for now). A recording replaces the built-in sound with the same name.
- In game: **M** mutes. Settings has Master / Music / Effects / Voice sliders, and they're saved.

How it's mixed: gunshots, doors and footsteps pan left and right with where they happen on screen and get quieter with distance. They sound muffled through a wall and more muffled through a floor, and they echo off the room. Music switches from stealth to combat when a suspect spots you and back a few seconds after the fight ends. Below 35 health you hear your heartbeat and the world goes muffled.

### Adding recorded sounds

1. Put mp3 files in `audio/`, named after the sound they replace (`kick.mp3`, `shot_player_1.mp3`, `shot_player_2.mp3`, ...). Numbered files are variants, and a random one plays each time.
2. Run `python tools/build_bank.py`, which packs them into `audio/bank.js`.

`python tools/make_audio.py` generates the full recorded set (effects, music, narrator, suspect shouts, radio dispatcher) with ElevenLabs. It needs `ELEVENLABS_API_KEY` set. These names only exist as recordings: `vo_intro_1`..`5` (intro narration; without them the browser's built-in voice reads it), `bark_alert_*`, `bark_sus_*` (suspects shouting), and `disp_start` / `disp_win` / `disp_down` (radio dispatcher).

In the browser console, `HotEntryAudio.sfx('kick')` plays any sound.
