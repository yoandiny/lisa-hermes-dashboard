/**
 * Wake word "Hey Lisa" — browser SpeechRecognition (default) or Porcupine (.ppn).
 * Loaded as module; hooks via window.__lisaWake after app.js defines RT / transmit / convo.
 */
const WAKE_RE = /\bhey[\s,]*lisa\b/i;

let wakeWanted = false;
let wakeRec = null;
let wakeActive = false;
let porcupineStop = null;

function deps(){
  return window.__lisaWake || {};
}

function canWake(){
  const { convo, running, suppress } = deps();
  return wakeWanted && !convo && !running && !suppress;
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
  setWakeUi(false);
}

export function pauseWake(){
  stopWake();
}

export async function resumeWake(){
  if (!wakeWanted) return;
  await startWake();
}

export function setWakeWanted(on){
  wakeWanted = !!on;
  const btn = document.getElementById('btnWake');
  if (btn) btn.setAttribute('aria-pressed', wakeWanted ? 'true' : 'false');
  if (wakeWanted) startWake();
  else stopWake();
}

async function onWakeHit(remainder){
  const d = deps();
  d.log?.('voice', 'WAKE', remainder
    ? `Hey Lisa + command: "${remainder.slice(0, 80)}"`
    : 'Hey Lisa detected');
  stopWake();
  if (remainder){
    await d.transmit?.(remainder);
    if (wakeWanted) setTimeout(() => resumeWake(), 600);
    return;
  }
  if (d.startConvo){
    await d.startConvo();
  } else if (d.micToggle){
    await d.micToggle();
  }
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
  if (WAKE_RE.test(text)){
      const rest = stripWake(text);
      onWakeHit(rest);
    }
  };
  wakeRec.onerror = (ev) => {
    if (ev.error === 'not-allowed'){
      wakeWanted = false;
      const btn = document.getElementById('btnWake');
      if (btn) btn.setAttribute('aria-pressed', 'false');
      deps().log?.('error', 'WAKE', 'microphone denied for wake word');
    }
    wakeActive = false;
    setWakeUi(false);
  };
  wakeRec.onend = () => {
    wakeActive = false;
    if (canWake()) setTimeout(startSpeechWake, 350);
    else setWakeUi(false);
  };
  try {
    wakeRec.start();
  } catch (_) {
    wakeActive = false;
    setWakeUi(false);
  }
}

async function startPorcupineWake(_cfg){
  // Custom .ppn from Picovoice Console — wire Web Voice Processor when a model is shipped in ui/wake/.
  return false;
}

export async function startWake(cfg){
  stopWake();
  if (!wakeWanted || !canWake()) return;
  if (await startPorcupineWake(cfg)) return;
  startSpeechWake();
}

export function initWake(cfg){
  const enabled = cfg?.wake_word !== false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasPorcupine = !!(cfg?.porcupine_key && cfg?.porcupine_keyword);
  const btn = document.getElementById('btnWake');
  if (!btn) return;
  if (!enabled || (!SR && !hasPorcupine)){
    btn.disabled = true;
    btn.title = 'Wake word needs Chrome speech or Porcupine (.ppn)';
    return;
  }
  btn.disabled = false;
  btn.addEventListener('click', () => setWakeWanted(!wakeWanted));
  if (cfg?.wake_autostart !== false){
    wakeWanted = true;
    btn.setAttribute('aria-pressed', 'true');
    startWake(cfg);
  }
}