/* Hot Entry - built-in sound set.
   Every sound and music loop here is synthesized in code when the game starts, so the game has full
   audio with no files and no internet. If audio/bank.js (recorded sounds) is present, any sound it
   contains replaces the synthesized one with the same name.
   HE_SYNTH(sampleRate, part) -> { name: [variant, ...] }, each variant is Float32Array (mono) or [L, R]. */
window.HE_SYNTH = function (sr, part) {   // part: 'sfx' | 'music' | undefined (both)
  const TAU = Math.PI * 2;
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const buf = d => new Float32Array(Math.ceil(sr * d));
  const N = (n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1; return x; };

  // ---- filters (all in place) ----
  function lp(x, fc) { const a = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } return x; }
  function hp(x, fc) { const a = Math.exp(-TAU * fc / sr); let y = 0, p = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; y = a * (y + v - p); p = v; x[i] = y; } return x; }
  function bp(x, f, q) {
    const w = TAU * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    return x;
  }
  function gain(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
  function norm(x, p = .9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m ? gain(x, p / m) : x; }
  function mix(dst, src, at = 0, g = 1) { const o = Math.floor(at * sr); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g; return dst; }
  // wrap-around mix for loops: anything past the end continues at the start
  function mixLoop(dst, src, at, g = 1) { const o = Math.floor(at * sr), n = dst.length; for (let i = 0; i < src.length; i++) dst[(o + i) % n] += src[i] * g; }
  function shape(x, fn) { for (let i = 0; i < x.length; i++) x[i] *= fn(i / sr); return x; }
  const ex = tau => t => Math.exp(-t / tau);
  const ad = (a, tau) => t => t < a ? t / a : Math.exp(-(t - a) / tau);
  function tone(d, f0, f1, tau, type = 'sin') {   // pitch-swept oscillator with exp decay
    const x = buf(d); let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, f = f1 ? f0 * Math.pow(f1 / f0, Math.min(1, t / d)) : f0; ph += f / sr;
      const p = ph % 1; x[i] = (type === 'saw' ? 2 * p - 1 : type === 'tri' ? 1 - 4 * Math.abs(p - .5) : type === 'sq' ? (p < .5 ? 1 : -1) : Math.sin(TAU * ph)) * Math.exp(-t / tau);
    }
    return x;
  }
  function noiseHit(d, tau, filt) { const x = shape(N(Math.ceil(sr * d)), ex(tau)); return filt ? filt(x) : x; }

  // ---- tiny stereo reverb (comb + allpass), returns [L, R] ----
  function verb(mono, wet = .3, size = 1, tail = 1.2) {
    const n = mono.length + Math.floor(sr * tail), out = [new Float32Array(n), new Float32Array(n)];
    const combs = [[1557, 1617, 1491, 1422], [1277, 1356, 1188, 1116]], fb = .78 + .1 * Math.min(1, size), damp = .25;
    for (let c = 0; c < 2; c++) {
      const o = out[c]; for (let i = 0; i < mono.length; i++) o[i] = mono[i] * (1 - wet * .5);
      const acc = new Float32Array(n);
      for (const L0 of combs[c]) {
        const L = Math.floor(L0 * size * sr / 44100), line = new Float32Array(L); let k = 0, st = 0;
        for (let i = 0; i < n; i++) { const y = line[k]; st = y * (1 - damp) + st * damp; line[k] = (i < mono.length ? mono[i] : 0) + st * fb; k = (k + 1) % L; acc[i] += y * .25; }
      }
      for (const L0 of [556, 441]) {
        const L = Math.floor((L0 + c * 23) * sr / 44100), line = new Float32Array(L); let k = 0;
        for (let i = 0; i < n; i++) { const b = line[k], v = acc[i]; line[k] = v + b * .5; acc[i] = b - v; k = (k + 1) % L; }
      }
      for (let i = 0; i < n; i++) o[i] += acc[i] * wet;
    }
    return out;
  }
  // make a noise bed loop seamlessly by folding its tail onto its head
  function loopify(x, xf) {
    const f = Math.floor(sr * xf), y = x.slice(0, x.length - f);
    for (let i = 0; i < f; i++) { const t = i / f; y[i] = x[i] * Math.sqrt(t) + x[x.length - f + i] * Math.sqrt(1 - t); }
    return y;
  }
  const v = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const S = {};

  function brass(f, d, g = 1) {  // detuned saws through an opening low-pass
    const x = buf(d); for (const dt of [1, 1.006, .995]) mix(x, tone(d, f * dt, 0, 99, 'saw'), 0, .33);
    let y = 0; for (let i = 0; i < x.length; i++) { const t = i / sr, fc = 300 + 2500 * Math.min(1, t / .08) * Math.exp(-t / (d * .6)), a = 1 - Math.exp(-TAU * fc / sr); y += a * (x[i] - y); x[i] = y * ad(.02, d * .5)(t) * g; }
    return x;
  }
  function bell(f, d, g = 1) { const x = buf(d); for (const [m, a, tau] of [[1, 1, .9], [2.76, .4, .3], [5.4, .2, .12]]) mix(x, tone(d, f * m, 0, tau * d), 0, a * g); return x; }
  function piano(f, d, g = 1) { const x = buf(d); for (const [m, a] of [[1, 1], [2, .4], [3, .15]]) mix(x, tone(d, f * m, 0, d * .35 / m, 'tri'), 0, a * g); shape(x, ad(.004, 99)); return x; }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  if (part !== 'music') {
  // ================= weapons =================
  function gunshot(i, o) {
    const d = o.d, x = buf(d), j = 1 + (rnd() - .5) * .12;
    mix(x, hp(noiseHit(.03, .0035), 2500), 0, 1.1);                                // crack
    mix(x, lp(noiseHit(.12, o.body), o.bright * j), 0, 1.4);                         // body
    mix(x, tone(.2, o.thump * j, 45, .05), 0, o.low);                                 // chest thump
    mix(x, lp(noiseHit(d, o.tail), 900), .01, .35);                                   // room tail
    return norm(x);
  }
  S.shot_player = v(3, i => gunshot(i, { d: .7, body: .028, bright: 2600, thump: 150, low: .9, tail: .16 }));
  S.shot_pistol = v(2, i => gunshot(i, { d: .7, body: .035, bright: 1700, thump: 120, low: .7, tail: .2 }));
  S.shot_smg = v(3, i => gunshot(i, { d: .35, body: .016, bright: 3000, thump: 170, low: .5, tail: .07 }));
  S.casing = v(3, i => {
    const x = buf(.6), base = 3000 + rnd() * 900;
    [[0, 1], [.09 + rnd() * .03, .5], [.17 + rnd() * .04, .25], [.22 + rnd() * .03, .12]].forEach(([at, g]) => {
      for (const m of [1, 1.62, 2.43]) mix(x, tone(.12, base * m, 0, .025 / m), at, g / m);
    });
    return norm(x, .6);
  });
  S.impact_wall = v(3, i => {
    const x = buf(.45); mix(x, lp(noiseHit(.08, .012), 2400), 0, 1); mix(x, tone(.08, 220, 90, .02), 0, .5);
    for (let k = 0; k < 14; k++) mix(x, bp(noiseHit(.02, .003), 1500 + rnd() * 3000, 2), .02 + rnd() * .3, .25 * rnd()); // debris
    return norm(x, .8);
  });
  S.impact_body = v(2, i => { const x = buf(.3); mix(x, tone(.25, 110, 50, .05), 0, 1); mix(x, lp(noiseHit(.1, .02), 600), 0, .8); return norm(x, .8); });
  function click(x, at, f = 2500, g = 1) { mix(x, hp(noiseHit(.012, .0018), 2000), at, g); mix(x, tone(.05, f, 0, .008), at, g * .5); }
  S.dry_fire = [(() => { const x = buf(.12); click(x, 0, 2600, 1); return norm(x, .5); })()];
  S.reload = [(() => {
    const x = buf(1.3);
    click(x, 0, 2200);                                                                   // mag release
    mix(x, bp(noiseHit(.25, .06), 1200, 1.5), .12, .4);                                  // mag sliding out
    click(x, .32, 1800, .7);
    click(x, .68, 1500, 1.2); mix(x, tone(.08, 180, 90, .02), .68, .4);                  // new mag seated
    mix(x, bp(shape(N(Math.ceil(sr * .12)), t => Math.sin(Math.PI * t / .12)), 2500, 1.2), .95, .5); // slide back
    click(x, 1.08, 2800, 1.3); mix(x, tone(.1, 160, 80, .03), 1.08, .5);                 // slide forward
    return norm(x, .8);
  })()];

  // ================= body + doors + movement =================
  function grunt(f0, d, vowel) {   // crude formant voice for pain sounds when no recording is loaded
    const src = tone(d, f0, f0 * .7, 10, 'saw'); shape(src, ad(.015, d * .35));
    const x = buf(d); for (const [f, g] of vowel) mix(x, bp(src.slice(), f, 6), 0, g);
    mix(x, bp(noiseHit(d, d * .3), 1800, 1), 0, .15);
    return norm(x, .7);
  }
  S.hurt = v(3, i => grunt(120 + rnd() * 30, .32, [[620, 1], [1050, .6], [2500, .2]]));
  S.enemy_down = v(2, i => {
    const x = buf(1.1); mix(x, grunt(105 + rnd() * 15, .45, [[550, 1], [900, .5]]), 0, .6);
    mix(x, tone(.3, 90, 40, .07), .4, 1); mix(x, lp(noiseHit(.2, .04), 400), .4, .9);   // body hits floor
    mix(x, tone(.2, 70, 40, .05), .55, .4);
    return norm(x);
  });
  S.kick = v(2, i => {
    const x = buf(1.2);
    mix(x, tone(.4, 120, 38, .08), 0, 1.3); mix(x, lp(noiseHit(.2, .03), 1400), 0, 1);  // boot + door
    for (let k = 0; k < 24; k++) mix(x, bp(noiseHit(.03, .006), 900 + rnd() * 2600, 3), rnd() * .2, .5 * rnd()); // splinters
    mix(x, tone(.4, 95, 40, .07), .2 + rnd() * .04, 1); mix(x, lp(noiseHit(.25, .05), 900), .2, .8); // slam into wall
    const [L] = verb(x, .2, .8, .6); return norm(L);
  });
  function creak(d, f0) {
    const x = buf(d); let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, f = f0 * (1 + .35 * Math.sin(t * 3.1) + .15 * Math.sin(t * 17)) * (1 + .5 * t / d); ph += f / sr;
      const grain = (Math.sin(TAU * ph * 1) > .2 ? 1 : 0) * (.6 + .4 * Math.sin(t * 90));
      x[i] = grain * (2 * (ph % 1) - 1) * Math.sin(Math.PI * Math.min(1, t / d));
    }
    return norm(bp(bp(x, f0 * 3, 2), f0 * 5, 1.5), .5);
  }
  S.door_open = v(2, i => creak(.9, 120 + rnd() * 60));
  S.step_wood = v(4, i => {
    const x = buf(.25); mix(x, tone(.12, 95 + rnd() * 20, 55, .025), 0, 1);
    mix(x, lp(noiseHit(.08, .012), 900 + rnd() * 600), 0, .8); mix(x, hp(noiseHit(.03, .006), 2000), .005, .15);
    return norm(x, .8);
  });
  S.stairs = [(() => { const x = buf(1.0); [0, .22, .42, .63].forEach((at, k) => mix(x, S.step_wood[k % 4], at, .9 - k * .1)); mix(x, creak(.5, 140), .3, .2); return norm(x, .8); })()];
  S.takedown = [(() => {
    const x = buf(3.0), r = N(Math.ceil(sr * 2.2));
    for (let i = 0; i < r.length; i++) { const t = i / sr; r[i] *= (.4 + .6 * Math.abs(Math.sin(t * 9 + Math.sin(t * 23)))) * Math.min(1, t * 4); }
    mix(x, bp(r, 2600, .8), 0, .35); mix(x, lp(N(Math.ceil(sr * 2.2)), 300), 0, .2);    // cloth + scuffle
    [.4, .9, 1.3, 1.7].forEach(at => mix(x, tone(.15, 80, 50, .04), at, .4));             // struggle bumps
    mix(x, tone(.35, 85, 38, .08), 2.2, 1); mix(x, lp(noiseHit(.25, .05), 450), 2.2, .9); // slump
    return norm(x, .8);
  })()];
  S.ziptie = [(() => { const x = buf(1.0), r = N(Math.ceil(sr * .8)); shape(r, t => t * 1.25 * (.6 + .4 * Math.sin(t * 70)));
    mix(x, bp(r, 1800, 3), 0, .5); click(x, .82, 3200, 1.4); return norm(x, .8); })()];
  S.medkit = [(() => { const x = buf(1.4); click(x, 0, 1500, 1); click(x, .06, 1800, .8);
    const tear = N(Math.ceil(sr * .4)); shape(tear, t => Math.sin(Math.PI * t / .4)); mix(x, bp(tear, 3500, 1.2), .35, .5);
    for (let k = 0; k < 40; k++) mix(x, hp(noiseHit(.006, .0015), 2500), .9 + k * .009 + rnd() * .004, .4); // velcro
    return norm(x, .7); })()];
  S.trunk = [(() => { const x = buf(1.0); click(x, 0, 900, 1.2); mix(x, creak(.6, 90), .08, .35); return norm(x, .7); })()];

  // ================= stingers + UI =================
  S.alert_sting = [(() => { const x = buf(2.2); [38, 45, 50, 51].forEach(m => mix(x, brass(hz(m), 1.6), 0, .4)); mix(x, lp(noiseHit(.6, .15), 3000), 0, .5); mix(x, tone(.8, 60, 30, .3), 0, .9); const [L, R] = verb(x, .35, 1.2, 1.5); return [norm(L), norm(R)]; })()];
  S.win_sting = [(() => { const x = buf(3.6); [[62, 0], [66, .16], [69, .32], [74, .5]].forEach(([m, at]) => mix(x, brass(hz(m), 3.0 - at), at, .45)); [50, 57].forEach(m => mix(x, brass(hz(m), 2.6), .5, .4)); mix(x, lp(noiseHit(1.5, .5), 6000), .5, .25); const [L, R] = verb(x, .35, 1.2, 1.5); return [norm(L), norm(R)]; })()];
  S.lose_sting = [(() => { const x = buf(4.0); [[74, 0], [72, .45], [69, .9], [65, 1.35]].forEach(([m, at]) => mix(x, piano(hz(m), 2.4), at, .5)); [38, 45, 50, 53].forEach(m => mix(x, tone(3.5, hz(m), 0, 1.4, 'tri'), 1.3, .15)); const [L, R] = verb(x, .4, 1.3, 2); return [norm(L, .8), norm(R, .8)]; })()];
  S.objective = [(() => { const x = buf(1.6); [[79, 0], [83, .08], [86, .16]].forEach(([m, at]) => mix(x, bell(hz(m), 1.3), at, .4)); const [L, R] = verb(x, .3, 1, 1); return [norm(L, .7), norm(R, .7)]; })()];
  S.ui_click = [norm(mix(mix(buf(.06), tone(.05, 1900, 1400, .008), 0, 1), hp(noiseHit(.01, .002), 3000), 0, .3), .4)];
  S.ui_confirm = [(() => { const x = buf(.9), w = N(Math.ceil(sr * .5)); shape(w, t => Math.sin(Math.PI * t / .5)); mix(x, bp(w, 1200, .7), 0, .5); mix(x, tone(.5, 90, 45, .12), .38, 1); return norm(x, .7); })()];
  S.radio_squelch = v(2, i => { const x = buf(.35); mix(x, bp(shape(N(Math.ceil(sr * .18)), t => 1), 1800, .8), 0, .6); mix(x, tone(.06, 1250, 0, 99, 'sq'), .18, .12); click(x, .24, 1500, .5); return norm(x, .6); });
  S.heartbeat = [(() => { const x = buf(1.0); for (const [at, g] of [[0, 1], [.24, .7]]) { mix(x, tone(.2, 62, 38, .05), at, g); mix(x, lp(noiseHit(.1, .02), 160), at, g * .6); } return norm(x, .9); })()];
  S.lighter = [(() => { const x = buf(2.2); click(x, 0, 3000, 1); mix(x, hp(noiseHit(.15, .03), 3500), .01, .5);
    const c = buf(1.4); for (let k = 0; k < 160; k++) mix(c, hp(noiseHit(.004, .001), 3000), rnd() * 1.3, .3 * rnd()); shape(c, t => Math.sin(Math.PI * t / 1.4)); mix(x, c, .6, 1);
    const br = N(Math.ceil(sr * 1.3)); shape(br, t => Math.sin(Math.PI * t / 1.3)); mix(x, lp(br, 900), .6, .25);
    return norm(x, .6); })()];
  S.boat_horn = [(() => { const x = buf(3.2); for (const f of [92, 138, 184]) mix(x, tone(3.2, f, 0, 99, 'saw'), 0, .3); lp(x, 500); shape(x, t => Math.min(1, t / .3) * Math.min(1, (3.2 - t) / .8)); const [L, R] = verb(x, .6, 1.5, 3); return [norm(L, .6), norm(R, .6)]; })()];
  S.siren_far = [(() => { const d = 6, x = buf(d); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / sr, f = 900 + 350 * Math.sin(TAU * t / 1.6); ph += f / sr; x[i] = Math.sin(TAU * ph) * Math.min(1, t / 1.5, (d - t) / 1.5); } lp(x, 1400); const [L, R] = verb(x, .7, 1.6, 3); return [norm(L, .35), norm(R, .35)]; })()];

  // ================= ambience beds (stereo, seamless) =================
  function bed(d, make) { return [loopify(make(), 1.5), loopify(make(), 1.5)].map(c => c.slice(0, Math.floor(sr * (d - 1.5)))); }
  function brown(n) { const x = N(n); let y = 0; for (let i = 0; i < n; i++) { y = (y + x[i] * .02) * .998; x[i] = y * 8; } return x; }
  S.amb_city = [bed(14, () => { const n = Math.ceil(sr * 14), x = lp(brown(n), 400);
    const water = lp(N(n), 700); for (let i = 0; i < n; i++) { const t = i / sr; water[i] *= Math.max(0, Math.sin(t * 1.3 + Math.sin(t * .37) * 3)) ** 3; }
    mix(x, water, 0, .6); const wind = bp(N(n), 500, .5); shape(wind, t => .5 + .5 * Math.sin(t * .4)); mix(x, wind, 0, .25); return norm(x, .5); })];
  S.amb_interior = [bed(12, () => { const n = Math.ceil(sr * 12), x = gain(lp(brown(n), 250), .7);
    for (const [f, g] of [[60, .05], [120, .03], [180, .012]]) mix(x, tone(12, f, 0, 99), 0, g);
    return norm(x, .35); })];
  S.amb_car = [bed(12, () => { const n = Math.ceil(sr * 12), x = buf(12); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr, f = 34 + 1.5 * Math.sin(t * .7); ph += f / sr; const p = ph % 1; x[i] = (2 * p - 1) * .6 + Math.sin(TAU * ph * 2) * .3; }
    lp(x, 180); mix(x, lp(brown(n), 700), 0, .5); const hiss = hp(N(n), 3000); mix(x, hiss, 0, .04); return norm(x, .55); })];
  S.radio_chatter = [(() => {   // garbled dispatcher babble with squelch breaks, mono
    const d = 10, x = buf(d); let t = .3;
    while (t < d - 1.5) {
      const len = .8 + rnd() * 1.6, n = Math.ceil(sr * len), s = new Float32Array(n); let ph = 0, f0 = 150 + rnd() * 70;
      for (let i = 0; i < n; i++) { const tt = i / sr, syl = Math.max(0, Math.sin(tt * (9 + rnd() * .3) * Math.PI)) ** .5, f = f0 * (1 + .15 * Math.sin(tt * 4.3)); ph += f / sr; s[i] = (2 * (ph % 1) - 1) * syl; }
      const vo = buf(len); for (const [f, g] of [[700, 1], [1200, .7], [2300, .3]]) mix(vo, bp(s.slice(), f * (0.9 + rnd() * .2), 5), 0, g);
      mix(vo, bp(N(n), 1800, .6), 0, .12); mix(x, vo, t, .5); mix(x, S.radio_squelch[0], t + len, .7);
      t += len + .6 + rnd() * 1.8;
    }
    return norm(bp(x, 1500, .5), .5);
  })()];

  }
  if (part !== 'sfx') {
  // ================= music loops (stereo, seamless) =================
  function song(bpm, bars, fn) {
    const beat = 60 / bpm, d = beat * 4 * bars, L = new Float32Array(Math.floor(sr * d)), R = new Float32Array(L.length);
    const put = (x, at, g = 1, pan = 0) => { mixLoop(L, x, at, g * Math.min(1, 1 - pan)); mixLoop(R, x, at, g * Math.min(1, 1 + pan)); };
    fn(put, beat);
    const n = Math.max(...[L, R].map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))) || 1;
    return [gain(L, .85 / n), gain(R, .85 / n)];
  }
  const kick = () => { const x = buf(.4); mix(x, tone(.4, 140, 42, .09), 0, 1); mix(x, hp(noiseHit(.01, .002), 1500), 0, .3); return x; };
  const snare = () => { const x = buf(.3); mix(x, tone(.15, 210, 160, .04), 0, .5); mix(x, bp(noiseHit(.25, .06), 2500, .7), 0, 1); return x; };
  const hat = (o) => hp(noiseHit(o ? .25 : .05, o ? .08 : .012), 7000);
  const brush = () => { const x = N(Math.ceil(sr * .3)); shape(x, t => Math.sin(Math.PI * t / .3) ** 2); return bp(x, 4000, .6); };
  function bass(f, d, bright = 600) { const x = tone(d, f, 0, 99, 'saw'); mix(x, tone(d, f / 2, 0, 99), 0, .5); lp(x, bright); return shape(x, ad(.005, d * .45)); }
  function pad(f, d) { const x = buf(d); for (const dt of [1, 1.004, .996]) mix(x, tone(d, f * dt, 0, 99, 'saw'), 0, .3); lp(x, 900); return shape(x, t => Math.min(1, t / .6, (d - t) / .8)); }
  const DM = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];           // Dm  Bb  Gm  A
  S.mus_stealth = [song(96, 8, (put, b) => {
    for (let bar = 0; bar < 8; bar++) {
      const ch = DM[Math.floor(bar / 2) % 4], t0 = bar * 4 * b, root = ch[0] - 12;
      if (bar % 2 === 0) for (const m of ch) put(pad(hz(m), 8 * b), t0, .07, (m % 3 - 1) * .4);
      [0, 0, 0, 3, 0, 0, -2, 0].forEach((st, k) => put(bass(hz(root + (k === 3 ? 3 : k === 6 ? -2 : 0)), b * .45, 420), t0 + k * b / 2, .5));
      for (let k = 0; k < 8; k++) put(hat(false), t0 + k * b / 2, k % 2 ? .12 : .05, .3);
      put(tone(.08, 1200, 0, .02), t0 + 3.5 * b, .05, -.5);                                                       // clock tick
      if (bar % 2 === 1) { const m = [62, 65, 69, 72, 74][Math.floor(rnd() * 5)]; put(piano(hz(m), 2.5), t0 + (1 + Math.floor(rnd() * 2)) * b, .18, .3); }
    }
  })];
  S.mus_combat = [song(96, 8, (put, b) => {
    for (let bar = 0; bar < 8; bar++) {
      const ch = DM[Math.floor(bar / 2) % 4], t0 = bar * 4 * b, root = ch[0] - 12;
      for (let k = 0; k < 16; k++) put(bass(hz(root + (k % 8 === 7 ? 7 : 0)), b * .22, 900), t0 + k * b / 4, .45);
      [0, 1.5, 2, 3.25].forEach(at => put(kick(), t0 + at * b, .9));
      [1, 3].forEach(at => put(snare(), t0 + at * b, .55, .1));
      for (let k = 0; k < 16; k++) put(hat(k === 14), t0 + k * b / 4, k % 4 === 2 ? .16 : .07, -.3);
      if (bar % 2 === 0) for (const m of ch) put(brass(hz(m + 12), b * 1.2), t0, .14, (m % 3 - 1) * .5);
      if (bar % 2 === 1) for (const m of ch) put(brass(hz(m + 12), b * .5), t0 + 2.5 * b, .1, (m % 3 - 1) * .5);
      for (const m of ch) put(pad(hz(m), 4 * b), t0, .05);
    }
  })];
  // noir lobby: Dm9 | Dm9 | Gm9 | Gm9 | Em7b5 | A7b9 | Dm9 | A7b9, walking bass, brushes, soft piano comping
  const NOIR = [[50, 53, 57, 60, 64], [50, 53, 57, 60, 64], [43, 46, 50, 53, 57], [43, 46, 50, 53, 57], [52, 55, 58, 62], [45, 49, 55, 58], [50, 53, 57, 60, 64], [45, 49, 55, 58]];
  S.mus_lobby = [song(72, 8, (put, b) => {
    for (let bar = 0; bar < 8; bar++) {
      const ch = NOIR[bar], t0 = bar * 4 * b, r = ch[0] - 12, nxt = NOIR[(bar + 1) % 8][0] - 12;
      [r, r + 3 + (bar % 2), r + 7, nxt + 1].forEach((m, k) => put(bass(hz(m), b * .9, 380), t0 + k * b, .55));       // walking bass
      for (let k = 0; k < 4; k++) put(brush(), t0 + k * b, k % 2 ? .22 : .1, .2);
      [0, 2 / 3, 1, 2, 2 + 2 / 3, 3].forEach((at, k) => put(hat(false), t0 + at * b, .04 + (k % 3 === 1 ? .03 : 0), .5));   // ride swing
      for (const m of ch.slice(1)) put(piano(hz(m + 12), b * 1.8), t0 + (bar % 2 ? 1.66 : 0) * b, .1, -.2);
      if (bar % 4 === 2) { [69, 67, 65, 62].forEach((m, k) => put(bell(hz(m + 12), 1.2), t0 + (k * .66 + .5) * b, .07, .4)); }
    }
  })];
  }
  return S;
};
