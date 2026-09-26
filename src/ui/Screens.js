const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const v = localStorage.getItem(`somnia:${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(`somnia:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable – settings just won't persist */
  }
}

/** Loading, title, pause and game-over overlays plus the settings controls. */
export class Screens {
  constructor(game) {
    this.game = game;
    this.els = { loading: $('loading'), title: $('title'), pause: $('pause'), over: $('over') };
    $('startBtn').addEventListener('click', () => game.start());
    $('resumeBtn').addEventListener('click', () => game.resume());
    $('restartBtn').addEventListener('click', () => game.restart());
    $('againBtn').addEventListener('click', () => game.restart());

    const sens = load('sens', 1);
    const vol = load('vol', 0.8);
    const quality = load('quality', true);
    const sensEls = [$('sens'), $('sens2')];
    const volEls = [$('vol'), $('vol2')];
    const setSens = (v) => {
      game.input.sensitivity = v;
      sensEls.forEach((el) => (el.value = v));
      save('sens', v);
    };
    const setVol = (v) => {
      game.audio.setVolume(v);
      volEls.forEach((el) => (el.value = v));
      save('vol', v);
    };
    sensEls.forEach((el) => el.addEventListener('input', () => setSens(parseFloat(el.value))));
    volEls.forEach((el) => el.addEventListener('input', () => setVol(parseFloat(el.value))));
    $('quality').checked = quality;
    $('quality').addEventListener('change', (e) => {
      game.render.setQuality(e.target.checked);
      save('quality', e.target.checked);
    });
    setSens(sens);
    setVol(vol);
    this.quality = quality;
  }

  only(name) {
    for (const [k, el] of Object.entries(this.els)) el.classList.toggle('hidden', k !== name);
  }

  loading(p, text) {
    $('loadFill').style.width = `${Math.round(p * 100)}%`;
    $('loadStep').textContent = text;
  }

  showTitle() {
    this.only('title');
  }

  showPause() {
    this.only('pause');
  }

  hideAll() {
    this.only(null);
  }

  showOver(stats, reason) {
    $('overEyebrow').textContent = reason === 'fall' ? 'The floor let you go' : 'The dream lets go';
    $('overTitle').textContent = 'You woke up';
    const mins = Math.floor(stats.time / 60);
    const secs = String(Math.floor(stats.time % 60)).padStart(2, '0');
    $('stats').innerHTML = `
      <div><b>${stats.round}</b><span>Dreams reached</span></div>
      <div><b>${stats.kills}</b><span>Knights unmade</span></div>
      <div><b>${stats.trapKills}</b><span>Dreamfalls</span></div>
      <div><b>${mins}:${secs}</b><span>Time asleep</span></div>`;
    this.only('over');
  }
}
