import './styles.css';
import { Game } from './core/Game.js';

const game = new Game();
window.somnia = game; // handy for debugging from the console
game.init().catch((err) => {
  console.error(err);
  const step = document.getElementById('loadStep');
  if (step) step.textContent = `The dream failed to form: ${err.message}`;
});
