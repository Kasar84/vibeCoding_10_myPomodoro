/**
 * ZenPomodoro - Audio Engine (Web Audio API)
 * 네트워크 의존성과 CORS 오류 없이 100% 오프라인에서도 작동하는 고품질 사운드 합성 엔진
 * - 백색소음: 파도(Ocean Waves), 빗소리(Rainfall), 숲속 새소리(Forest Birds)
 * - 알림음: 맑고 영롱한 마림바/벨 하모닉 차임 (C5 - E5 - G5 - C6)
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.currentTrack = 'none'; // 'ocean' | 'rain' | 'birds' | 'none'
    this.volume = 0.7;
    this.isMuted = false;
    this.activeNodes = [];
    this.birdsTimer = null;
  }

  // 브라우저 자동재생 정책 대응을 위한 Context 초기화
  initContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();

      // 마스터 볼륨 게인
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 앰비언트 사운드 전용 게인
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.ambientGain.connect(this.masterGain);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 볼륨 조절 (0.0 ~ 1.0)
  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
    }
  }

  // 음소거 토글
  setMuted(muted) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
    }
  }

  // 앰비언트 트랙 재생 시작
  playAmbient(track) {
    this.initContext();
    this.stopAmbient();
    this.currentTrack = track;

    if (track === 'ocean' || track === 'wind') {
      this.createOceanSound(); // 자연스러운 바람/미풍 앰비언스
    } else if (track === 'rain') {
      this.createRainSound();
    } else if (track === 'birds') {
      this.createBirdsSound();
    }
  }

  // 현재 앰비언트 트랙 중지
  stopAmbient() {
    if (this.birdsTimer) {
      clearInterval(this.birdsTimer);
      this.birdsTimer = null;
    }

    this.activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {
        // 무시
      }
    });
    this.activeNodes = [];
    this.currentTrack = 'none';
  }

  /**
   * 노이즈 버퍼 생성 (화이트/핑크/브라운)
   */
  createNoiseBuffer(type = 'white', seconds = 5) {
    const bufferSize = this.ctx.sampleRate * seconds;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;

      if (type === 'white') {
        data[i] = white * 0.3;
      } else if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
        b6 = white * 0.115926;
      } else if (type === 'brown') {
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 1.8;
      }
    }
    return buffer;
  }

  /**
   * 1. 🌊 파도 소리 (Ocean Waves)
   * 브라운 노이즈 + 저주파 대역통과 필터 + LFO(주기적 파도 밀려옴/물러남 변조)
   */
  createOceanSound() {
    const noiseBuffer = this.createNoiseBuffer('brown', 6);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // 저역 통과 필터 (깊은 물소리)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);
    filter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    // 파도 주기적인 밀물/썰물 게인 LFO (약 8초 주기)
    const waveGain = this.ctx.createGain();
    waveGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime); // ~8초 주기

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(0.45, this.ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(waveGain.gain);

    // 필터 프리퀀시도 LFO로 변조하여 파도가 부서질 때 고음 발생
    const filterLfo = this.ctx.createGain();
    filterLfo.gain.setValueAtTime(450, this.ctx.currentTime);
    lfo.connect(filterLfo);
    filterLfo.connect(filter.frequency);

    noiseSource.connect(filter);
    filter.connect(waveGain);
    waveGain.connect(this.ambientGain);

    noiseSource.start();
    lfo.start();

    this.activeNodes.push(noiseSource, lfo, filter, waveGain, lfoGain, filterLfo);
  }

  /**
   * 2. 🌧️ 빗소리 (Rainfall)
   * 핑크 노이즈 + 고역/저역 대역통과 필터 + 미세 빗방울 타격감
   */
  createRainSound() {
    // 지속적인 부드러운 비 (핑크 노이즈 베이스)
    const noiseBuffer = this.createNoiseBuffer('pink', 5);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, this.ctx.currentTime);
    filter.Q.setValueAtTime(0.7, this.ctx.currentTime);

    const rainGain = this.ctx.createGain();
    rainGain.gain.setValueAtTime(0.65, this.ctx.currentTime);

    // 바닥에 부딪히는 하이햇/물방울 틱 노이즈
    const clickBuffer = this.createNoiseBuffer('white', 4);
    const clickSource = this.ctx.createBufferSource();
    clickSource.buffer = clickBuffer;
    clickSource.loop = true;

    const clickFilter = this.ctx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(4500, this.ctx.currentTime);

    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(0.09, this.ctx.currentTime);

    noiseSource.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(this.ambientGain);

    clickSource.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.ambientGain);

    noiseSource.start();
    clickSource.start();

    this.activeNodes.push(noiseSource, clickSource, filter, clickFilter, rainGain, clickGain);
  }

  /**
   * 3. 🐦 숲속 새소리 (Forest Birds)
   * 부드러운 바람(저역 노이즈) 배경음 + 주기적이고 자연스러운 새 지저귐 FM 신시사이저
   */
  createBirdsSound() {
    // 숲속 은은한 미풍 배경
    const windBuffer = this.createNoiseBuffer('pink', 6);
    const windSource = this.ctx.createBufferSource();
    windSource.buffer = windBuffer;
    windSource.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(400, this.ctx.currentTime);

    const windGain = this.ctx.createGain();
    windGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambientGain);
    windSource.start();

    this.activeNodes.push(windSource, windFilter, windGain);

    // 자연스러운 무작위 새소리 트리거 (간격을 기존 2800ms에서 1400ms로 절반 단축)
    const chirp = () => {
      if (this.currentTrack !== 'birds' || !this.ctx) return;
      this.playBirdChirp();
      // 35% 확률로 0.15초 뒤 두 번째 화답 지저귐
      if (Math.random() > 0.65) {
        setTimeout(() => {
          if (this.currentTrack === 'birds' && this.ctx) {
            this.playBirdChirp();
          }
        }, 160);
      }
    };

    chirp();
    this.birdsTimer = setInterval(() => {
      if (Math.random() > 0.25) {
        chirp();
      }
    }, 1400); // 1.4초마다 체크 (기존 2.8초에서 절반으로 단축)
  }

  /**
   * 단일 새소리 합성 (FM 피치 엔벨로프)
   */
  playBirdChirp() {
    if (!this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const chirpGain = this.ctx.createGain();

    // 새 지저귐 기본 고주파수 (2.5kHz ~ 3.5kHz)
    const baseFreq = 2200 + Math.random() * 1200;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq + 1000 + Math.random() * 600, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(baseFreq - 300, now + 0.18);

    // 볼륨 엔벨로프 (짧고 선명한 트릴)
    chirpGain.gain.setValueAtTime(0.001, now);
    chirpGain.gain.linearRampToValueAtTime(0.18, now + 0.04);
    chirpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(chirpGain);
    chirpGain.connect(this.ambientGain);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * 4. 🔔 세션 종료 알림음 (Session Chime)
   * 맑고 은은한 하모닉스 벨 코드 (C5, E5, G5, C6 아르페지오)
   */
  playAlarm() {
    this.initContext();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const startTime = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = startTime + idx * 0.12;
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      // 서스테인과 자연스러운 릴리즈를 갖춘 차임벨 엔벨로프
      gainNode.gain.setValueAtTime(0.001, noteTime);
      gainNode.gain.linearRampToValueAtTime(0.3, noteTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.8);

      osc.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 1.9);
    });
  }
}

// 전역 인스턴스 생성
window.zenSoundEngine = new SoundEngine();
