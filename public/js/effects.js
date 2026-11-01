import { icon } from './dom.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['var(--pink)', 'var(--yellow)', 'var(--cyan)', 'var(--purple)'];
const SHAPES = ['sparkle', 'leaf', 'sparkle', 'shears'];

// Confete do corte final: brilhos, folhas e tesourinhas nas cores do jogo.
// Cada peça anima só transform (ver .leaf-rain no CSS).
export function confetti(container, count = 34) {
  if (REDUCED_MOTION || !container) return;

  const random = (min, max) => min + Math.random() * (max - min);
  const pieces = Array.from({ length: count }, (_, i) => {
    const piece = icon(SHAPES[i % SHAPES.length]);
    piece.style.setProperty('--x', `${random(0, 100)}vw`);
    piece.style.setProperty('--size', `${random(16, 34)}px`);
    piece.style.setProperty('--dur', `${random(2.4, 4.2)}s`);
    piece.style.setProperty('--delay', `${random(0.3, 1.2)}s`);
    piece.style.setProperty('--drift', `${random(-90, 90)}px`);
    piece.style.setProperty('--spin', `${random(-540, 540)}deg`);
    piece.style.setProperty('--c', COLORS[i % COLORS.length]);
    return piece;
  });

  container.replaceChildren(...pieces);
  setTimeout(() => container.replaceChildren(), 6000);
}
