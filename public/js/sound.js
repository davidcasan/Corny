import { setIcon } from './dom.js';

// Sons curtos gerados na hora (Web Audio): nada para baixar.
// O navegador só toca som depois de um toque/clique, e todos os sons aqui
// respondem a um toque do jogador.

const STORAGE_KEY = 'corny:muted';

let context = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Sem armazenamento (aba anônima etc.): vale só para esta visita
  }
}

function audio() {
  if (muted) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  return context;
}

// Alguém se salvou: "plim" subindo
export function playSave() {
  const ac = audio();
  if (!ac) return;
  tones(ac, [659.25, 987.77], { gap: 0.07, length: 0.22, volume: 0.14, type: 'sine' });
}

// Corte final: "tchk-tchk" da tesoura e uma fanfarra curta
export function playCut() {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime;
  for (const offset of [0, 0.09]) blade(ac, start + 0.3 + offset);
  tones(ac, [523.25, 659.25, 783.99, 1046.5], { delay: 0.55, gap: 0.11, length: 0.45, volume: 0.18, type: 'triangle' });
}

function blade(ac, when) {
  const length = Math.floor(ac.sampleRate * 0.045);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 3200;
  const gain = ac.createGain();
  gain.gain.value = 0.35;

  source.connect(filter).connect(gain).connect(ac.destination);
  source.start(when);
}

function tones(ac, frequencies, { delay = 0, gap, length, volume, type }) {
  const start = ac.currentTime + delay;
  frequencies.forEach((frequency, i) => {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = ac.createGain();
    const t = start + i * gap;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
  });
}

export function setupSoundButton(button) {
  if (!button) return;
  const render = () => {
    setIcon(button.querySelector('svg'), muted ? 'sound-off' : 'sound-on');
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? 'Som desligado' : 'Som ligado');
  };
  button.addEventListener('click', () => {
    setMuted(!muted);
    render();
  });
  render();
}
