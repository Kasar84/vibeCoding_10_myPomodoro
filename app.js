/**
 * ZenPomodoro - Main Application Controller
 * - 25m Focus / 5m Break Auto Loop
 * - Precise Timestamp Calculation (Anti-Drift for background tabs)
 * - SVG Progress Ring
 * - Real-time Browser Tab Title Updates
 * - LocalStorage State Persistence & Safe Fallback
 * - Keyboard Shortcuts (Space, R, M)
 */

(function () {
  'use strict';

  // Constants & Durations (in seconds)
  const FOCUS_TIME = 25 * 60; // 25분 (1,500초)
  const BREAK_TIME = 5 * 60;  // 5분 (300초)
  const CIRCLE_RADIUS = 130;
  const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS; // ~816.814

  // LocalStorage Keys
  const STORAGE_KEYS = {
    SESSIONS: 'zen_pomodoro_completed_sessions',
    MINUTES: 'zen_pomodoro_total_focus_minutes',
    SOUND: 'zen_pomodoro_ambient_sound',
    VOLUME: 'zen_pomodoro_volume',
    MUTED: 'zen_pomodoro_is_muted'
  };

  // State
  let mode = 'focus'; // 'focus' | 'break'
  let timeLeft = FOCUS_TIME;
  let totalDuration = FOCUS_TIME;
  let isRunning = false;
  let timerInterval = null;
  let targetEndTime = null;

  // Persistent State
  let completedSessions = 0;
  let totalFocusMinutes = 0;
  let currentSound = 'none';
  let volume = 0.7;
  let isMuted = false;

  // DOM Elements
  const body = document.body;
  const timeDisplay = document.getElementById('timeDisplay');
  const timerStatusText = document.getElementById('timerStatusText');
  const progressRing = document.getElementById('progressRing');
  const modeTag = document.getElementById('modeTag');
  const modeText = document.getElementById('modeText');

  const btnToggle = document.getElementById('btnToggle');
  const toggleIcon = document.getElementById('toggleIcon');
  const toggleText = document.getElementById('toggleText');
  const btnReset = document.getElementById('btnReset');

  const sessionCountEl = document.getElementById('sessionCount');
  const totalMinutesEl = document.getElementById('totalMinutes');
  const btnResetStats = document.getElementById('btnResetStats');

  const soundButtons = document.querySelectorAll('.btn-sound-track');
  const currentSoundStatus = document.getElementById('currentSoundStatus');
  const btnMute = document.getElementById('btnMute');
  const muteIcon = document.getElementById('muteIcon');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValueText = document.getElementById('volumeValue');

  /**
   * Safe LocalStorage Helper
   */
  const storage = {
    get(key, defaultVal) {
      try {
        const val = localStorage.getItem(key);
        return val !== null ? JSON.parse(val) : defaultVal;
      } catch (e) {
        console.warn('LocalStorage Read Error:', e);
        return defaultVal;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.warn('LocalStorage Write Error:', e);
      }
    }
  };

  /**
   * Initialize App State from LocalStorage
   */
  function initStorage() {
    completedSessions = storage.get(STORAGE_KEYS.SESSIONS, 0);
    totalFocusMinutes = storage.get(STORAGE_KEYS.MINUTES, 0);
    currentSound = storage.get(STORAGE_KEYS.SOUND, 'none');
    volume = storage.get(STORAGE_KEYS.VOLUME, 0.7);
    isMuted = storage.get(STORAGE_KEYS.MUTED, false);

    updateStatsUI();

    // Sound engine initial settings
    if (window.zenSoundEngine) {
      window.zenSoundEngine.volume = volume;
      window.zenSoundEngine.isMuted = isMuted;
    }

    // Apply Sound UI
    volumeSlider.value = Math.round(volume * 100);
    volumeValueText.textContent = `${Math.round(volume * 100)}%`;
    updateVolumeSliderTrack();
    updateMuteUI();
    setActiveSoundButton(currentSound);
  }

  /**
   * Format Seconds to MM:SS
   */
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Update Circular Progress Ring SVG
   */
  function updateProgressRing() {
    if (!progressRing) return;
    const progressRatio = Math.max(0, Math.min(1, timeLeft / totalDuration));
    const offset = CIRCUMFERENCE * (1 - progressRatio);
    progressRing.style.strokeDashoffset = offset;
  }

  /**
   * Update Browser Tab Title
   */
  function updateTabTitle() {
    const formatted = formatTime(timeLeft);
    if (!isRunning) {
      if (timeLeft === totalDuration) {
        document.title = 'ZenPomodoro | 몰입을 돕는 포모도로 타이머';
      } else {
        document.title = `[일시정지] ${formatted} - ZenPomodoro`;
      }
      return;
    }

    if (mode === 'focus') {
      document.title = `[${formatted}] 🎯 집중 중 - ZenPomodoro`;
    } else {
      document.title = `[${formatted}] ☕ 휴식 중 - ZenPomodoro`;
    }
  }

  /**
   * Update Main Display and UI
   */
  function updateTimerDisplay() {
    timeDisplay.textContent = formatTime(timeLeft);
    updateProgressRing();
    updateTabTitle();
  }

  /**
   * Update Stats UI
   */
  function updateStatsUI() {
    sessionCountEl.textContent = completedSessions;
    totalMinutesEl.textContent = totalFocusMinutes;
  }

  /**
   * Apply Theme according to Mode (Focus vs Break)
   */
  function applyTheme() {
    if (mode === 'break') {
      body.classList.add('mode-break');
      modeText.textContent = '휴식 시간 (5m)';
      timerStatusText.textContent = '편안하게 숨을 고르고 휴식하세요';
    } else {
      body.classList.remove('mode-break');
      modeText.textContent = '집중 시간 (25m)';
      timerStatusText.textContent = isRunning ? '현재 과업에 온전히 몰입하세요' : '집중에 몰입해 보세요';
    }
    updateTimerDisplay();
  }

  /**
   * Switch Mode (Focus <-> Break)
   */
  function switchMode(newMode) {
    mode = newMode;
    totalDuration = mode === 'focus' ? FOCUS_TIME : BREAK_TIME;
    timeLeft = totalDuration;
    applyTheme();
  }

  /**
   * Handle Session Finished (25m Focus or 5m Break ends)
   */
  function handleSessionComplete() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;

    // 1. Play Session Alarm
    if (window.zenSoundEngine) {
      window.zenSoundEngine.playAlarm();
    }

    // 2. If Focus session just finished -> Increment Counter & Save
    if (mode === 'focus') {
      completedSessions += 1;
      totalFocusMinutes += 25;
      storage.set(STORAGE_KEYS.SESSIONS, completedSessions);
      storage.set(STORAGE_KEYS.MINUTES, totalFocusMinutes);
      updateStatsUI();

      // Switch to Break mode
      switchMode('break');
    } else {
      // Break session finished -> Switch back to Focus
      switchMode('focus');
    }

    // 3. Auto-start the next session as requested
    startTimer();
  }

  /**
   * Timer Tick (with anti-drift calculation)
   */
  function timerTick() {
    const now = Date.now();
    const remainingMs = targetEndTime - now;

    if (remainingMs <= 0) {
      timeLeft = 0;
      updateTimerDisplay();
      handleSessionComplete();
      return;
    }

    timeLeft = Math.ceil(remainingMs / 1000);
    updateTimerDisplay();
  }

  /**
   * Start Timer
   */
  function startTimer() {
    if (isRunning) return;

    // Resume/initialize audio context if sound is active
    if (window.zenSoundEngine) {
      window.zenSoundEngine.initContext();
    }

    isRunning = true;
    targetEndTime = Date.now() + timeLeft * 1000;

    btnToggle.classList.remove('btn-secondary-action');
    btnToggle.classList.add('btn-primary-action');
    toggleIcon.textContent = '⏸';
    toggleText.textContent = '일시정지';
    btnToggle.setAttribute('aria-label', '타이머 일시정지');

    timerStatusText.textContent = mode === 'focus' ? '현재 과업에 온전히 몰입하세요' : '편안하게 숨을 고르고 휴식하세요';

    updateTabTitle();
    timerInterval = setInterval(timerTick, 250);
  }

  /**
   * Pause Timer
   */
  function pauseTimer() {
    if (!isRunning) return;

    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;

    toggleIcon.textContent = '▶';
    toggleText.textContent = '계속하기';
    btnToggle.setAttribute('aria-label', '타이머 재개');

    timerStatusText.textContent = '일시정지되었습니다';
    updateTabTitle();
  }

  /**
   * Toggle Timer
   */
  function toggleTimer() {
    if (isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  /**
   * Reset Timer
   */
  function resetTimer() {
    pauseTimer();
    timeLeft = totalDuration;
    toggleIcon.textContent = '▶';
    toggleText.textContent = '시작';
    btnToggle.setAttribute('aria-label', '타이머 시작');
    timerStatusText.textContent = mode === 'focus' ? '집중에 몰입해 보세요' : '휴식 준비 완료';
    updateTimerDisplay();
  }

  /**
   * Reset Stats (Completed Sessions)
   */
  function resetStats() {
    if (completedSessions === 0 && totalFocusMinutes === 0) return;
    
    const confirmReset = window.confirm('지금까지 완료한 세션 기록을 모두 초기화하시겠습니까?');
    if (confirmReset) {
      completedSessions = 0;
      totalFocusMinutes = 0;
      storage.set(STORAGE_KEYS.SESSIONS, 0);
      storage.set(STORAGE_KEYS.MINUTES, 0);
      updateStatsUI();
    }
  }

  /**
   * Sound Track Selection
   */
  function setActiveSoundButton(trackName) {
    soundButtons.forEach(btn => {
      const isMatch = btn.getAttribute('data-sound') === trackName;
      btn.classList.toggle('active', isMatch);
    });

    const labelMap = {
      ocean: '바람 소리 재생 중',
      wind: '바람 소리 재생 중',
      rain: '빗소리 재생 중',
      birds: '숲속 새소리 재생 중',
      none: '꺼짐'
    };
    currentSoundStatus.textContent = labelMap[trackName] || '꺼짐';
  }

  function handleSoundSelect(trackName) {
    currentSound = trackName;
    storage.set(STORAGE_KEYS.SOUND, currentSound);
    setActiveSoundButton(trackName);

    if (window.zenSoundEngine) {
      if (trackName === 'none') {
        window.zenSoundEngine.stopAmbient();
      } else {
        window.zenSoundEngine.playAmbient(trackName);
      }
    }
  }

  /**
   * Volume Controls
   */
  function updateVolumeSliderTrack() {
    const val = volumeSlider.value;
    volumeSlider.style.background = `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${val}%, rgba(255, 255, 255, 0.15) ${val}%, rgba(255, 255, 255, 0.15) 100%)`;
  }

  function handleVolumeChange(e) {
    const val = parseFloat(e.target.value);
    volume = val / 100;
    volumeValueText.textContent = `${Math.round(val)}%`;
    updateVolumeSliderTrack();

    storage.set(STORAGE_KEYS.VOLUME, volume);

    if (isMuted && val > 0) {
      // Auto-unmute when moving slider
      isMuted = false;
      storage.set(STORAGE_KEYS.MUTED, false);
      updateMuteUI();
    }

    if (window.zenSoundEngine) {
      window.zenSoundEngine.setVolume(volume);
    }
  }

  function updateMuteUI() {
    btnMute.classList.toggle('is-muted', isMuted);
    muteIcon.textContent = isMuted ? '🔇' : '🔊';
  }

  function toggleMute() {
    isMuted = !isMuted;
    storage.set(STORAGE_KEYS.MUTED, isMuted);
    updateMuteUI();

    if (window.zenSoundEngine) {
      window.zenSoundEngine.setMuted(isMuted);
    }
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    // Timer Control Buttons
    btnToggle.addEventListener('click', toggleTimer);
    btnReset.addEventListener('click', resetTimer);
    btnResetStats.addEventListener('click', resetStats);

    // Sound Selection Buttons
    soundButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const sound = btn.getAttribute('data-sound');
        handleSoundSelect(sound);
      });
    });

    // Volume Slider & Mute
    volumeSlider.addEventListener('input', handleVolumeChange);
    btnMute.addEventListener('click', toggleMute);

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Ignore if typing inside any input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') {
        e.preventDefault();
        resetTimer();
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') {
        e.preventDefault();
        toggleMute();
      }
    });

    // Window Visibility change: immediately sync display when switching back
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && isRunning && targetEndTime) {
        timerTick();
      }
    });
  }

  /**
   * Application Boot
   */
  function init() {
    // 1. Set progress ring dash constants
    if (progressRing) {
      progressRing.style.strokeDasharray = CIRCUMFERENCE;
      progressRing.style.strokeDashoffset = '0';
    }

    // 2. Load stored preferences
    initStorage();

    // 3. Setup event listeners
    setupEventListeners();

    // 4. Initial Theme and Display
    applyTheme();
    updateTimerDisplay();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
