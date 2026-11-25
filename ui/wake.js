/**
 * Wake word "Hey Lisa" — ElevenLabs VAD (preferred) or browser SpeechRecognition.
 */
const WAKE_RE = /\b(hey\s*[,]?\s*lisa|heylisa|hey\s+lee\s*sa|a\s+lee\s*sa)\b/i;

let wakeWanted = false;
let wakeRec = null;
let wakeActive = false;
let porcupineStop = null;

let wakeStream = null, wakeRecorder = null, wakeChunks = [];
let wakeCtx = null, wakeAnalyser = null, wakeVdata = null, wakeVad = null;
let wakeSpoke = false, wakeLoudAt = 0, wakeTurnStart = 0;
let wakeFloorSum = 0, wakeFloorN = 0, wakeThreshold = 0.02, wakeCalibrating = true;
const WAKE_SILENCE = 850, WAKE_MIN_MS = 400, WAKE_MAX_MS = 12000;

function deps(){
  return window.__lisaWake || {};
}

function isMobile(){
  return matchMedia('(pointer:coarse)').matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

async function isBrave(){
  try {
    return navigator.brave && await navigator.brave.isBrave();
  } catch (_) {
    return false;
  }
}

function speechApiOK(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return !!SR;
}

function canWake(){
  const { convo, running, suppress } = deps();
  return wakeWanted && !convo && !running && !suppress;
}

function pickMime(){
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'])
    if (window.MediaRecorder?.isTypeSupported?.(m)) return { mimeType: m };
  return undefined;
}

function setWakeUi(on){
  const btn = document.getElementById('btnWake');
  const app = document.getElementById('app');
  const hint = document.getElementById('footHint');
  if (btn){
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
  }
  if (app) app.dataset.wake = on ? 'on' : 'off';
  if (hint && on){
    hint.textContent = 'À l\'écoute de « Hey Lisa » — ou appuyez sur le micro';
  } else if (hint && !on && deps().convo){
    hint.textContent = 'Conversation active — micro en écoute';
  } else if (hint && !on){
    hint.textContent = 'Activez « Hey Lisa » ou appuyez sur le micro';
  }
}

function stripWake(text){
  return String(text || '').replace(WAKE_RE, '').replace(/\s+/g, ' ').trim();
}

function cleanupWakeMedia(){
  if (wakeVad){ clearInterval(wakeVad); wakeVad = null; }
  if (wakeRecorder && wakeRecorder.state === 'recording'){
    wakeRecorder._cancel = true;
    try { wakeRecorder.stop(); } catch (_) { /* ignore */ }
  }
  wakeRecorder = null;
  wakeChunks = [];
  if (wakeStream){
    wakeStream.getTracks().forEach(t => t.stop());
    wakeStream = null;
  }
  if (wakeCtx){
    wakeCtx.close().catch(() => {});
    wakeCtx = null;
  }
  wakeAnalyser = null;
}

export function wakeEnabled(){
  return wakeWanted;
}

export function stopWake(){
  wakeActive = false;
  if (wakeRec){
    try { wakeRec.onend = null; wakeRec.stop(); } catch (_) { /* ignore */ }
    wakeRec = null;
  }
  if (porcupineStop){
    porcupineStop().catch(() => {});
    porcupineStop = null;
  }
  cleanupWakeMedia();
  setWakeUi(false);
}

export function pauseWake(){
  stopWake();
}

export async function resumeWake(){
  if (!wakeWanted) return;
  await startWake(deps().wakeCfg);
}

export function setWakeWanted(on){
  wakeWanted = !!on;
  const btn = document.getElementById('btnWake');
  if (btn) btn.setAttribute('aria-pressed', wakeWanted ? 'true' : 'false');
  if (wakeWanted) startWake(deps().wakeCfg);
  else stopWake();
}

function playWakeChime(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ctx.currentTime + 0.01;
    const playTone = (freq, start, dur, vol) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };
    playTone(784, t0, 0.12, 0.09);
    playTone(1175, t0 + 0.09, 0.18, 0.08);
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch (_) { /* ignore */ }
}

async function onWakeHit(remainder){
  playWakeChime();
  const d = deps();
  d.log?.('voice', 'WAKE', remainder
    ? `Hey Lisa + command: "${remainder.slice(0, 80)}"`
    : 'Hey Lisa detected');
  stopWake();
  if (remainder){
    await d.transmit?.(remainder);
    if (wakeWanted) setTimeout(() => resumeWake(), 800);
    return;
  }
  if (d.micToggle) await d.micToggle();
}

function startSpeechWake(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !canWake() || wakeActive) return;
  wakeRec = new SR();
  wakeRec.lang = 'en-US';
  wakeRec.continuous = true;
  wakeRec.interimResults = true;
  wakeActive = true;
  setWakeUi(true);

  wakeRec.onresult = (e) => {
    let chunk = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      chunk += e.results[i][0].transcript;
    }
    const text = chunk.trim();
    if (!text) return;
    if (WAKE_RE.test(text)) onWakeHit(stripWake(text));
  };
  wakeRec.onerror = (ev) => {
    const d = deps();
    const msg = ev.error || 'error';
    if (ev.error === 'not-allowed'){
      wakeWanted = false;
      document.getElementById('btnWake')?.setAttribute('aria-pressed', 'false');
      d.log?.('error', 'WAKE', 'Micro refusé. Autorisez le micro pour ce site (icône cadenas).');
    } else if (ev.error === 'service-not-allowed' || ev.error === 'network'){
      d.log?.('error', 'WAKE', 'Speech API indisponible (Brave ?). Utilisez ElevenLabs STT ou Chrome.');
      wakeWanted = false;
    } else {
      d.log?.('note', 'WAKE', `speech wake: ${msg}`);
    }
    wakeActive = false;
    setWakeUi(false);
  };
  wakeRec.onend = () => {
    wakeActive = false;
    if (canWake()) setTimeout(startSpeechWake, 500);
    else setWakeUi(false);
  };
  try {
    wakeRec.start();
    deps().log?.('voice', 'WAKE', 'écoute navigateur (Hey Lisa)');
  } catch (err) {
    deps().log?.('error', 'WAKE', 'impossible de démarrer la reconnaissance vocale');
    wakeActive = false;
    setWakeUi(false);
  }
}

function beginWakeTurn(){
  if (!wakeStream || !canWake()) return;
  wakeChunks = [];
  wakeSpoke = false;
  wakeFloorSum = 0;
  wakeFloorN = 0;
  wakeCalibrating = true;
  wakeThreshold = 0.02;
  wakeRecorder = new MediaRecorder(wakeStream, pickMime());
  wakeRecorder.ondataavailable = (e) => { if (e.data?.size) wakeChunks.push(e.data); };
  wakeRecorder.onstop = () => wakeShip();
  wakeRecorder.start(250);
  wakeTurnStart = wakeLoudAt = performance.now();
  if (!wakeVad) wakeVad = setInterval(wakeVtick, 45);
}

function wakeVtick(){
  if (!wakeAnalyser || !wakeRecorder || wakeRecorder.state !== 'recording') return;
  wakeAnalyser.getByteTimeDomainData(wakeVdata);
  let s = 0;
  for (let i = 0; i < wakeVdata.length; i++){
    const v = (wakeVdata[i] - 128) / 128;
    s += v * v;
  }
  const rms = Math.sqrt(s / wakeVdata.length);
  const t = performance.now();
  const app = document.getElementById('app');
  if (app && app.dataset.wake === 'on'){
    app.style.setProperty('--level', Math.min(1, rms * 3.5).toFixed(3));
  }

  if (wakeCalibrating){
    wakeFloorSum += rms;
    wakeFloorN++;
    if (t - wakeTurnStart > 280){
      const floor = wakeFloorSum / Math.max(1, wakeFloorN);
      wakeThreshold = Math.max(0.006, floor * 1.65 + 0.003);
      wakeCalibrating = false;
    }
    return;
  }

  if (rms > wakeThreshold){
    wakeLoudAt = t;
    if (!wakeSpoke) wakeSpoke = true;
  } else if (wakeSpoke && t - wakeLoudAt > WAKE_SILENCE){
    try { wakeRecorder.stop(); } catch (_) { /* ignore */ }
    return;
  }
  if (t - wakeTurnStart > WAKE_MAX_MS) try { wakeRecorder.stop(); } catch (_) { /* ignore */ }
}

async function wakeShip(){
  const cancel = wakeRecorder?._cancel;
  const blob = new Blob(wakeChunks, { type: wakeRecorder?.mimeType || 'audio/webm' });
  wakeChunks = [];
  if (cancel || !canWake()){
    if (canWake()) beginWakeTurn();
    return;
  }
  if (!wakeSpoke || blob.size < 1200 || performance.now() - wakeTurnStart < WAKE_MIN_MS){
    beginWakeTurn();
    return;
  }
  const d = deps();
  const hdrs = d.apiHeaders?.({ 'content-type': blob.type || 'audio/webm' }) || {};
  try {
    const r = await fetch('/api/listen', { method: 'POST', headers: hdrs, body: blob }).then(x => x.json());
    const text = (r.text || '').trim();
    deps().log?.('voice', 'WAKE', text ? `entendu: "${text.slice(0, 80)}"` : 'silence');
    if (text && WAKE_RE.test(text)){
      await onWakeHit(stripWake(text));
      return;
    }
  } catch (e) {
    d.log?.('error', 'WAKE', `STT wake: ${String(e).slice(0, 80)}`);
  }
  if (canWake()) beginWakeTurn();
}

async function startElevenLabsWake(){
  const d = deps();
  if (!d.stt || !canWake() || wakeActive) return false;
  try {
    wakeStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = e?.name || 'Error';
    let hint = String(e?.message || name).slice(0, 120);
    if (name === 'NotAllowedError'){
      hint = 'Micro refusé — autorisez-le pour ce site. Sur mobile : HTTPS ou localhost requis.';
    } else if (name === 'NotFoundError'){
      hint = 'Aucun micro détecté.';
    } else if (!window.isSecureContext){
      hint = 'Contexte non sécurisé : ouvrez via https:// ou http://127.0.0.1 (pas une IP LAN en http).';
    }
    d.log?.('error', 'WAKE', hint);
    wakeWanted = false;
    document.getElementById('btnWake')?.setAttribute('aria-pressed', 'false');
    return false;
  }
  wakeCtx = new (window.AudioContext || window.webkitAudioContext)();
  await wakeCtx.resume();
  wakeAnalyser = wakeCtx.createAnalyser();
  wakeAnalyser.fftSize = 1024;
  wakeVdata = new Uint8Array(wakeAnalyser.fftSize);
  wakeCtx.createMediaStreamSource(wakeStream).connect(wakeAnalyser);
  wakeActive = true;
  setWakeUi(true);
  d.log?.('voice', 'WAKE', 'écoute ElevenLabs (dites « Hey Lisa »)');
  beginWakeTurn();
  return true;
}

async function startPorcupineWake(){
  return false;
}

export async function startWake(cfg){
  stopWake();
  if (!wakeWanted || !canWake()) return;
  if (await startPorcupineWake(cfg)) return;
  if (cfg?.stt === 'elevenlabs' || deps().stt){
    if (await startElevenLabsWake()) return;
  }
  if (speechApiOK() && !(await isBrave())){
    startSpeechWake();
    return;
  }
  deps().log?.('error', 'WAKE',
    'Wake indisponible : ajoutez ELEVENLABS_API_KEY, ou utilisez Chrome (pas Brave) pour la reco navigateur.');
  wakeWanted = false;
  document.getElementById('btnWake')?.setAttribute('aria-pressed', 'false');
}

export async function initWake(cfg){
  const enabled = cfg?.wake_word !== false;
  const btn = document.getElementById('btnWake');
  if (!btn || !enabled) return;

  const hasStt = cfg?.stt === 'elevenlabs';
  const brave = await isBrave();
  const canSpeech = speechApiOK() && !brave;

  if (!hasStt && !canSpeech){
    btn.disabled = true;
    btn.title = 'Hey Lisa : ElevenLabs STT ou Chrome/Edge (Brave non supporté)';
    deps().log?.('note', 'WAKE',
      'Wake désactivé — Brave sans ElevenLabs, ou micro/Speech API indisponible.');
    return;
  }

  btn.disabled = false;
  if (brave && hasStt){
    btn.title = 'Hey Lisa via ElevenLabs (recommandé sur Brave)';
  } else if (isMobile()){
    btn.title = 'Touchez pour activer — le mobile exige un geste pour le micro';
  }

  btn.addEventListener('click', () => setWakeWanted(!wakeWanted));

  const autostart = cfg?.wake_autostart !== false && !isMobile() && !brave;
  if (autostart){
    wakeWanted = true;
    btn.setAttribute('aria-pressed', 'true');
    startWake(cfg);
  } else {
    deps().log?.('note', 'WAKE',
      isMobile()
        ? 'Touchez « Hey Lisa » pour activer (micro + geste requis sur mobile).'
        : (brave
          ? 'Brave : touchez « Hey Lisa » (ElevenLabs STT) ou utilisez Chrome.'
          : 'Touchez « Hey Lisa » pour activer l\'écoute.'));
  }
}