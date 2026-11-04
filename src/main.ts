import './style.css';
import { Game } from './game';

const viewport = document.getElementById('viewport') as HTMLElement | null;
if (!viewport) throw new Error('Missing #viewport');

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const parsedSeed = seedParam ? Number.parseInt(seedParam, 10) : NaN;
const seed = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : (Math.random() * 0xffffffff) >>> 0;

try {
  new Game(viewport, seed);
} catch (error) {
  console.error(error);
  const message = document.createElement('div');
  message.className = 'fatal-error';
  message.innerHTML = `<h1>Cinderline could not start</h1><p>${escapeHtml(
    error instanceof Error ? error.message : String(error),
  )}</p><p>This game needs WebGL 2. Try a current Chrome, Firefox, or Safari build.</p>`;
  document.body.appendChild(message);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
