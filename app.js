(() => {
  'use strict';

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const timeDisplay = $('timeDisplay');
  const modeLabel = $('modeLabel');
  const statusLabel = $('statusLabel');
  const startBtn = $('startBtn');
  const startLabel = startBtn.querySelector('.btn-label');
  const startIcon = startBtn.querySelector('.btn-icon');
  const resetBtn = $('resetBtn');
  const skipBtn = $('skipBtn');
  const ringProgress = $('ringProgress');
  const sessionCountEl = $('sessionCount');
  const focusMinutesEl = $('focusMinutes');
  const toast = $('toast');
  const presets = document.querySelectorAll('.preset');

  // ===== State =====
  const RING_CIRCUMFERENCE = 2 * Math.PI * 98; // r=98

  const defaults = {
    focus: 50,
    shortBreak: 10,
    longBreak: 20,
  };

  let state = loadState() || {
    focus: defaults.focus,
    shortBreak: defaults.shortBreak,
    longBreak: defaults.longBreak,
    sessions: 0,
    focusMinutes: 0,
    currentPhase: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
    remaining: defaults.focus * 60,
    isRunning: false,
    lastTick: null,
  };

  // ===== Persistence =====
  function saveState() {
    const persist = {
      focus: state.focus,
      shortBreak: state.shortBreak,
      longBreak: state.longBreak,
      sessions: state.sessions,
      focusMinutes: state.focusMinutes,
    };
    try { localStorage.setItem('pomoWave', JSON.stringify(persist)); } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem('pomoWave');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ===== Audio (WebAudio chime) =====
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function chime(freqs, dur = 0.4, type = 'sine', volume = 0.18) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(volume, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + dur + 0.05);
    });
  }

  const SOUNDS = {
    start:  () => chime([523.25, 659.25, 783.99], 0.5, 'triangle', 0.12),
    finish: () => chime([880, 1046.5, 1318.5], 0.8, 'sine', 0.15),
    breakStart: () => chime([392, 523.25, 659.25], 0.6, 'sine', 0.13),
    tick:   () => chime([1200], 0.05, 'square', 0.04),
    click:  () => chime([800], 0.08, 'square', 0.08),
  };

  // ===== Formatting =====
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  function format(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${pad(m)}:${pad(s)}`;
  }

  // ===== Render =====
  function render() {
    timeDisplay.textContent = format(state.remaining);
    sessionCountEl.textContent = state.sessions;
    focusMinutesEl.innerHTML = `${state.focusMinutes}<span class="unit">m</span>`;

    const isBreak = state.currentPhase !== 'focus';
    modeLabel.textContent = isBreak
      ? (state.currentPhase === 'longBreak' ? 'LONG BREAK' : 'SHORT BREAK')
      : 'FOCUS';
    modeLabel.className = 'mode ' + (isBreak ? 'is-break' : 'is-focus');

    statusLabel.textContent = state.isRunning ? 'RUNNING' : 'PAUSED';
    statusLabel.classList.toggle('is-running', state.isRunning);

    // Button state
    startBtn.classList.toggle('is-running', state.isRunning);
    startLabel.textContent = state.isRunning ? 'PAUSE' : 'START';
    startIcon.textContent = state.isRunning ? '❚❚' : '▶';

    // Ring
    const total = currentPhaseSeconds();
    const progress = total > 0 ? state.remaining / total : 0;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    ringProgress.style.strokeDashoffset = offset;

    // Document title
    document.title = state.isRunning
      ? `${format(state.remaining)} · ${state.currentPhase === 'focus' ? 'FOCUS' : 'BREAK'}`
      : 'SYNTHWAVE · POMODORO';
  }

  function currentPhaseSeconds() {
    return state.currentPhase === 'focus' ? state.focus * 60
         : state.currentPhase === 'longBreak' ? state.longBreak * 60
         : state.shortBreak * 60;
  }

  // ===== Timer Loop =====
  let intervalId = null;
  function tick() {
    if (!state.isRunning) return;
    state.remaining -= 1;
    if (state.remaining <= 0) {
      completePhase();
    }
    render();
  }

  function startLoop() {
    if (intervalId) return;
    intervalId = setInterval(tick, 1000);
  }

  function stopLoop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  // ===== Controls =====
  function toggleRunning() {
    ensureAudio();
    SOUNDS.click();
    state.isRunning = !state.isRunning;
    if (state.isRunning) startLoop(); else stopLoop();
    render();
  }

  function resetTimer() {
    SOUNDS.click();
    stopLoop();
    state.isRunning = false;
    state.remaining = currentPhaseSeconds();
    render();
    showToast('RESET');
  }

  function skipPhase() {
    SOUNDS.click();
    stopLoop();
    state.isRunning = false;
    advancePhase(true);
    render();
  }

  function completePhase() {
    stopLoop();
    state.isRunning = false;
    if (state.currentPhase === 'focus') {
      state.sessions += 1;
      state.focusMinutes += state.focus;
      saveState();
    }
    advancePhase(false);
    render();
    // auto-start the next phase
    state.isRunning = true;
    startLoop();
  }

  function advancePhase(skipped) {
    if (state.currentPhase === 'focus') {
      // long break every 4 sessions
      state.currentPhase = (state.sessions > 0 && state.sessions % 4 === 0)
        ? 'longBreak' : 'shortBreak';
      state.remaining = (state.currentPhase === 'longBreak' ? state.longBreak : state.shortBreak) * 60;
      SOUNDS.breakStart();
      showToast('BREAK TIME', true);
    } else {
      state.currentPhase = 'focus';
      state.remaining = state.focus * 60;
      SOUNDS.finish();
      showToast('BACK TO FOCUS', false);
    }
  }

  // ===== Presets =====
  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      ensureAudio();
      const mins = parseInt(btn.dataset.min, 10);
      presets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // ratio: break = focus / 5
      state.focus = mins;
      state.shortBreak = Math.max(5, Math.round(mins / 5));
      state.longBreak = Math.max(10, Math.round(mins * 0.4));
      if (state.currentPhase === 'focus') state.remaining = state.focus * 60;
      if (state.currentPhase === 'shortBreak') state.remaining = state.shortBreak * 60;
      if (state.currentPhase === 'longBreak') state.remaining = state.longBreak * 60;
      stopLoop();
      state.isRunning = false;
      SOUNDS.click();
      saveState();
      render();
    });
  });

  // ===== Custom duration: tap time =====
  let pressTimer = null;
  timeDisplay.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(() => {
      promptCustomDuration();
      pressTimer = null;
    }, 600);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
    timeDisplay.addEventListener(evt, () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });
  });

  // Short tap cycles presets (no-op if already running)
  timeDisplay.addEventListener('click', (e) => {
    // Only handle quick taps (handled by long press guard above)
  });

  function promptCustomDuration() {
    if (state.isRunning) {
      showToast('PAUSE FIRST');
      return;
    }
    ensureAudio();
    SOUNDS.click();
    const current = state.currentPhase === 'focus' ? state.focus
                  : state.currentPhase === 'shortBreak' ? state.shortBreak
                  : state.longBreak;
    const input = prompt(`Set ${state.currentPhase.toUpperCase()} duration in minutes (1-120):`, current);
    if (input === null) return;
    const n = parseInt(input, 10);
    if (isNaN(n) || n < 1 || n > 120) {
      showToast('INVALID');
      return;
    }
    if (state.currentPhase === 'focus') {
      state.focus = n;
      presets.forEach(b => b.classList.remove('active'));
    } else if (state.currentPhase === 'shortBreak') {
      state.shortBreak = n;
    } else {
      state.longBreak = n;
    }
    state.remaining = n * 60;
    saveState();
    render();
  }

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg, isBreak = false) {
    toast.textContent = msg;
    toast.classList.toggle('is-break', isBreak);
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ===== Wire up =====
  startBtn.addEventListener('click', toggleRunning);
  resetBtn.addEventListener('click', resetTimer);
  skipBtn.addEventListener('click', skipPhase);

  // Keyboard: space = start/pause, r = reset, s = skip
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); toggleRunning(); }
    else if (e.key === 'r' || e.key === 'R') resetTimer();
    else if (e.key === 's' || e.key === 'S') skipPhase();
  });

  // Init
  render();

  // Sync across tabs
  window.addEventListener('storage', () => {
    const fresh = loadState();
    if (fresh) {
      state.sessions = fresh.sessions;
      state.focusMinutes = fresh.focusMinutes;
      render();
    }
  });

  // Page visibility: when returning, re-render so ring is fresh
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
})();
