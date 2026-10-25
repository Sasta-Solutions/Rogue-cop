"""Generate Hot Entry's sound with ElevenLabs, then clean it up with ffmpeg.

    set ELEVENLABS_API_KEY=...      (or put it in tools/.env as ELEVENLABS_API_KEY=...)
    python tools/make_audio.py      -> tools/raw/*.mp3 (untouched downloads, skipped if present)
                                    -> audio/*.mp3     (trimmed, levelled, ready for the game)
    python tools/build_bank.py      -> audio/bank.js   (what index.html actually loads)

To replace a sound: drop your own file in audio/ with the same name and run build_bank.py.
To re-roll one: delete it from tools/raw/ and run this again.
"""
import json, os, subprocess, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, 'tools', 'raw'), os.path.join(ROOT, 'audio')
os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)

def api_key():
    if os.environ.get('ELEVENLABS_API_KEY'): return os.environ['ELEVENLABS_API_KEY']
    env = os.path.join(ROOT, 'tools', '.env')
    if os.path.exists(env):
        for l in open(env, encoding='utf-8'):
            if l.startswith('ELEVENLABS_API_KEY='): return l.split('=', 1)[1].strip().strip('"')
    sys.exit('Set ELEVENLABS_API_KEY first.')
KEY = api_key()
API = 'https://api.elevenlabs.io/v1'

# ---------------------------------------------------------------- sound list
# name: (prompt, seconds, variants)
SFX = {
 'shot_player':  ("single 9mm police handgun gunshot inside a house, sharp punchy crack with a short room echo, close, one shot only", 1.0, 3),
 'shot_pistol':  ("single pistol gunshot fired in the next room of a house, punchy crack with wall reflections, one shot only", 1.0, 2),
 'shot_smg':     ("one single submachine gun round, very short tight snappy crack, indoor, one shot only, no burst", 0.5, 3),
 'casing':       ("a single brass bullet casing dropping and bouncing on a wooden floor, small metallic tinkle", 0.7, 3),
 'impact_wall':  ("bullet hitting a plaster wall, sharp thud with a little crumbling debris", 0.6, 3),
 'impact_body':  ("bullet hitting a padded kevlar vest, dull heavy punch thud, video game hit", 0.5, 2),
 'hurt':         ("a man grunting in pain, short sharp oof, one grunt only", 0.6, 3),
 'enemy_down':   ("a man groaning and falling down onto a wooden floor with a heavy body thump", 1.2, 2),
 'reload':       ("pistol reload: magazine released and dropping, new magazine slapped in, slide racked, close and crisp", 1.3, 1),
 'dry_fire':     ("empty handgun trigger dry fire, single metallic click", 0.5, 1),
 'kick':         ("wooden door kicked open violently, frame splintering, door slamming hard against the wall", 1.3, 2),
 'door_open':    ("old wooden interior door creaking open slowly", 1.2, 2),
 'steps_wood':   ("slow evenly spaced footsteps of boots walking on old wooden floorboards indoors, clear separate steps", 6.0, 1),
 'stairs':       ("quick footsteps hurrying up a creaky wooden staircase", 1.2, 1),
 'takedown':     ("muffled scuffle: someone grabbed from behind, clothes rustling, short struggle, then a body slumping to the floor", 3.0, 1),
 'ziptie':       ("cutting through a thick plastic zip tie with snips, plastic strain then a sharp snap", 1.0, 1),
 'medkit':       ("first aid kit: plastic case clicked open, bandage wrapper torn, velcro strap", 1.5, 1),
 'trunk':        ("police car trunk lid unlatched and swinging open", 1.0, 1),
 'objective':    ("short positive video game objective complete sound, warm synth swell with a soft bell", 1.5, 1),
 'alert_sting':  ("sudden tense orchestral stinger, low brass stab and string hit, enemy spotted in a crime thriller video game", 2.0, 1),
 'win_sting':    ("short triumphant cinematic police drama victory stinger, bold brass and drums, ends cleanly", 4.0, 1),
 'lose_sting':   ("short somber mission failed stinger, low piano and dark strings, ends cleanly", 4.0, 1),
 'ui_click':     ("soft modern tactical menu button click, subtle and clean", 0.5, 1),
 'ui_confirm':   ("deep cinematic menu confirm whoosh with a low hit", 1.0, 1),
 'radio_squelch':("police radio squelch, short static burst and click", 0.6, 2),
 'heartbeat':    ("slow heavy human heartbeat, deep thumps, no music", 4.0, 1),
 'lighter':      ("cigarette lighter flick and a slow cigarette drag with paper crackle", 2.0, 1),
 'boat_horn':    ("distant ship horn echoing over a river at night", 3.5, 1),
 'siren_far':    ("police siren far away across a city at night, faint, echoing between buildings", 6.0, 1),
}
AMB = {  # long beds, made seamless in post
 'amb_city':     ("night city ambience on a bridge over a river, distant traffic hum, water lapping against concrete, soft wind, no music", 22.0),
 'amb_interior': ("tense quiet interior room tone of an old house at night, low electrical hum, faint city traffic outside, occasional floor creak, no music", 22.0),
 'amb_car':      ("inside an old car driving through a city at night, steady engine rumble, tire and road noise, wet street, no music", 22.0),
 'radio_chatter':("police car radio chatter in the background, dispatcher voices garbled through static and squelch, no clear words", 12.0),
}
VO_NARR = 'Tw2LVqLUUWkxqrCfFOpw'      # Cole - gritty narrator
VO_THUG = ['N2lVS1w4EtoT3dr4eOWO', 'SOYHLrjzK2X1ezoPC6cr']   # Callum, Harry
VO_DISP = 'EXAVITQu4vr4xnSDxMaL'      # Sarah - dispatcher, radio-filtered in post
VO = {  # name: (voice, text)
 'vo_intro_1': (VO_NARR, "[low, weary] Chicago. City of broad shoulders... and broken men."),
 'vo_intro_2': (VO_NARR, "[low, weary] Every night, somebody else's life goes up in smoke."),
 'vo_intro_3': (VO_NARR, "[low, grim] Crime runs these streets. Somebody has to stop it."),
 'vo_intro_4': (VO_NARR, "[cold, quiet] Tonight, the mafia boss dies."),
 'vo_intro_5': (VO_NARR, "[low, tired hope] Then maybe... just maybe... this city breathes again."),
 'bark_alert_1': (VO_THUG[0], "[shouting] Hey! It's a cop!"),
 'bark_alert_2': (VO_THUG[1], "[shouting] Over there! Get him!"),
 'bark_alert_3': (VO_THUG[0], "[yelling] Cops! Cops!"),
 'bark_alert_4': (VO_THUG[1], "[angry shout] He's in the house!"),
 'bark_sus_1':   (VO_THUG[0], "[suspicious, quiet] Huh? Who's there?"),
 'bark_sus_2':   (VO_THUG[1], "[uneasy] You hear that?"),
 'bark_sus_3':   (VO_THUG[0], "[muttering] Somebody's in here..."),
 'disp_start':   (VO_DISP, "[calm, professional] All units, hostage situation in progress. Entry team, you are clear to go."),
 'disp_win':     (VO_DISP, "[relieved] Scene is secure. Good work, officer."),
 'disp_down':    (VO_DISP, "[urgent] Officer down! Officer down! All units respond!"),
}
MUSIC_BPM = "96 BPM, D minor"
def sec(name, pos, ms): return {"section_name": name, "positive_local_styles": pos, "negative_local_styles": [], "duration_ms": ms, "lines": []}
MUSIC = {
 'mus_lobby': (["dark film noir jazz", "smoky late night city", "muted trumpet melody", "walking upright bass", "brushed drums", "lonely piano", "rain soaked streets", "instrumental", "slow, 72 BPM", "steady groove for looping, no big ending"],
               [sec("night", ["sparse piano and bass", "brushes"], 20000), sec("trumpet", ["muted trumpet melody enters", "same groove"], 22000), sec("drift", ["piano and trumpet trade", "same groove, no ending"], 20000)]),
 'mus_stealth': (["tense stealth video game music", "crime thriller", "low pulsing synth bass", "ticking muted percussion", "sparse dark noir piano notes", "suspense", "instrumental", MUSIC_BPM, "constant energy for looping, no intro, no ending"],
                 [sec("creep", ["pulse and ticking", "very restrained"], 20000), sec("tension", ["low strings swell under the pulse", "restrained"], 20000), sec("creep 2", ["pulse and ticking", "piano notes", "no ending"], 20000)]),
 'mus_combat': (["intense action video game combat music", "police thriller", "driving cinematic drums", "aggressive low staccato strings", "distorted synth bass", "brass hits", "instrumental", MUSIC_BPM, "constant high energy for looping, no intro, no ending"],
                [sec("firefight", ["full drums and staccato strings"], 16000), sec("push", ["brass hits", "same intensity"], 16000), sec("firefight 2", ["full drums and staccato strings", "no ending"], 16000)]),
}
NEG_MUSIC = ["vocals", "singing", "lyrics", "choir", "EDM drop", "happy", "major key pop", "fade out ending"]

# ---------------------------------------------------------------- downloads
def post(path, body, out, timeout=300):
    if os.path.exists(out): return 'have ' + os.path.basename(out)
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {'xi-api-key': KEY, 'Content-Type': 'application/json'})
    try:
        data = urllib.request.urlopen(req, timeout=timeout).read()
    except urllib.error.HTTPError as e:
        return 'FAILED %s %s %s' % (os.path.basename(out), e.code, e.read().decode(errors='replace')[:300])
    open(out, 'wb').write(data); return 'wrote ' + os.path.basename(out)

jobs = []
for name, (text, dur, n) in SFX.items():
    for i in range(1, n + 1):
        jobs.append(('/sound-generation?output_format=mp3_44100_128', {"text": text, "duration_seconds": dur, "prompt_influence": 0.5}, f'{name}_{i}.mp3' if n > 1 else f'{name}.mp3'))
for name, (text, dur) in AMB.items():
    jobs.append(('/sound-generation?output_format=mp3_44100_128', {"text": text, "duration_seconds": dur, "prompt_influence": 0.4}, f'{name}.mp3'))
for name, (voice, text) in VO.items():
    jobs.append((f'/text-to-speech/{voice}?output_format=mp3_44100_128', {"text": text, "model_id": "eleven_v3"}, f'{name}.mp3'))
for name, (glob, secs) in MUSIC.items():
    jobs.append(('/music?output_format=mp3_44100_192', {"composition_plan": {"positive_global_styles": glob, "negative_global_styles": NEG_MUSIC, "sections": secs}, "model_id": "music_v1"}, f'{name}.mp3'))

with ThreadPoolExecutor(4) as pool:
    for msg in pool.map(lambda j: post(j[0], j[1], os.path.join(RAW, j[2]), 600 if j[0].startswith('/music') else 300), jobs):
        print(msg, flush=True)

# ---------------------------------------------------------------- post-processing
SR = 44100
def load(path, ch=1):
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32).reshape(-1, ch).copy()
def save(x, path, kbps):
    ch = x.shape[1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-i', '-', '-b:a', f'{kbps}k', path],
                   input=np.clip(x, -1, 1).astype(np.float32).tobytes(), check=True)
def trim(x, thresh=0.02, pre=0.004, tail_db=-50):
    a = np.abs(x).max(axis=1); hot = np.where(a > thresh * a.max())[0]
    if not len(hot): return x
    s = max(0, hot[0] - int(pre * SR))
    quiet = np.where(a > a.max() * 10 ** (tail_db / 20))[0]
    e = min(len(x), quiet[-1] + int(.02 * SR))
    y = x[s:e].copy(); f = min(len(y), int(.03 * SR))
    y[-f:] *= np.linspace(1, 0, f)[:, None]          # no click at the end
    return y
def peak(x, db=-1.0): m = np.abs(x).max(); return x if m == 0 else x * (10 ** (db / 20) / m)
def rms_norm(x, db): r = np.sqrt((x ** 2).mean()); return x if r == 0 else x * (10 ** (db / 20) / r)
def loopify(x, xf_s=2.5):
    xf = int(xf_s * SR); y = x[:-xf].copy(); t = np.linspace(0, 1, xf)[:, None]
    y[:xf] = x[:xf] * np.sqrt(t) + x[-xf:] * np.sqrt(1 - t)   # tail folded onto head = seamless wrap
    return y
def radio(x):  # telephone/radio band + a little grit
    from numpy.fft import rfft, irfft, rfftfreq
    X = rfft(x[:, 0]); f = rfftfreq(len(x), 1 / SR); X[(f < 400) | (f > 3200)] = 0
    y = irfft(X, len(x)); y = np.tanh(y / (np.abs(y).max() + 1e-9) * 2.2)
    return y[:, None] * .8
def slice_steps(x, n=4):
    """Cut a walking recording into separate footsteps using an energy envelope."""
    a = np.abs(x[:, 0]); win = int(.012 * SR); env = np.convolve(a, np.ones(win) / win, 'same')
    th = env.max() * .25; on = []; i = 0; gap = int(.25 * SR)
    while i < len(env):
        if env[i] > th: on.append(i); i += gap
        else: i += 1
    steps = []
    for s in on:
        seg = x[max(0, s - int(.005 * SR)): s + int(.32 * SR)].copy()
        f = int(.08 * SR); seg[-f:] *= np.linspace(1, 0, f)[:, None]
        steps.append(seg)
    steps.sort(key=lambda s: -np.abs(s).max())       # loudest, cleanest hits first
    return steps[:n]

done = 0
for f in sorted(os.listdir(RAW)):
    if not f.endswith('.mp3'): continue
    name, src = f[:-4], os.path.join(RAW, f)
    if name.startswith('mus_'):
        save(rms_norm(loopify(load(src, 2), 3.0), -18), os.path.join(OUT, f), 128)
    elif name.startswith('amb_') or name == 'radio_chatter':
        x = load(src, 2) if name != 'radio_chatter' else load(src)
        save(rms_norm(loopify(x, 2.5), -24), os.path.join(OUT, f), 96)
    elif name == 'steps_wood':
        for i, s in enumerate(slice_steps(load(src)), 1): save(peak(s, -3), os.path.join(OUT, f'step_wood_{i}.mp3'), 96)
    elif name.startswith('disp_'):
        save(peak(radio(trim(load(src))), -2), os.path.join(OUT, f), 96)
    elif name.startswith(('vo_', 'bark_')):
        save(peak(trim(load(src), .01), -1.5), os.path.join(OUT, f), 96)
    else:
        save(peak(trim(load(src))), os.path.join(OUT, f), 96)
    done += 1
print('processed', done, 'files ->', OUT)
