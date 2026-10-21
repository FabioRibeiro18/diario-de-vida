// <companion-scene> — configurable mini gym room with the avatar inside.
// Pure CSS/SVG room (no extra images needed); the avatar picture comes from
// the same assets folder as <avatar-chooser>.
const SCENE_DEFAULT_ASSETS = new URL('./assets/', import.meta.url).href;
const SCENE_STAGES = [100, 90, 80, 70];
function sceneStageFor(kg) {
  if (kg >= 95) return 100;
  if (kg >= 85) return 90;
  if (kg >= 75) return 80;
  return 70;
}

export const HAIR_COLORS = {
  castanho: '#6b4b32', preto: '#22201f', loiro: '#c9a15a',
  ruivo: '#9b4a2f', grisalho: '#9aa0a6', azul: '#3b6fd4'
};
export const OUTFIT_COLORS = {
  teal: '#2d9488', escuro: '#303843', branco: '#e8ece9',
  vermelho: '#b94a48', azul: '#3b6fa8', roxo: '#7b5ea7'
};
const HAIR_STYLES = ['curto', 'medio', 'longo', 'rabo', 'caracois', 'careca'];
const OUTFIT_STYLES = ['tshirt', 'hoodie', 'top', 'fato'];
const ACCESSORIES = ['none', 'auscultadores', 'bone', 'sweatband', 'oculos', 'toalha', 'garrafa', 'medalha'];
const SCENES = ['ginasio', 'parque', 'praia', 'noite', 'minimal'];
const AURAS = ['none', 'suave', 'forte'];
const FRAMES = ['none', 'clara', 'dourada'];

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

const sceneTemplate = document.createElement('template');
sceneTemplate.innerHTML = `
<style>
:host { --scene-wall:#1b2535; --scene-floor:#2a2d3a; --scene-card:#ffffff; --scene-text:#233d30; --scene-primary:#2d6849; --scene-heart:#e15b64; display:block; font-family:system-ui,sans-serif; max-width:560px; }
* { box-sizing:border-box; }
.room { position:relative; height:340px; border-radius:24px; overflow:hidden; background:linear-gradient(var(--scene-wall) 0 62%, var(--scene-floor) 62% 100%); transition:background .35s, box-shadow .35s, border-color .35s; }
.room::before { content:""; position:absolute; left:0; right:0; top:62%; height:6px; background:rgba(0,0,0,.08); }
.room[data-scene="ginasio"] { background:linear-gradient(#1b2535 0 62%, #2a2d3a 62% 100%); }
.room[data-scene="parque"] { background:linear-gradient(#bfe3f2 0 48%, #7fae83 48% 64%, #8a9b64 64% 100%); }
.room[data-scene="praia"] { background:linear-gradient(#bfe3f2 0 45%, #6aa9bf 45% 58%, #e8d8a8 58% 70%, #d9c49a 70% 100%); }
.room[data-scene="noite"] { background:linear-gradient(#111827 0 62%, #202634 62% 100%); }
.room[data-scene="minimal"] { background:linear-gradient(#e9e4d8 0 66%, #d8d1c2 66% 100%); }
.room[data-aura="suave"] { box-shadow:inset 0 0 80px rgba(45,212,191,.35); }
.room[data-aura="forte"] { box-shadow:inset 0 0 110px rgba(45,212,191,.60); }
.room[data-frame="clara"] { border:7px solid rgba(255,255,255,.8); }
.room[data-frame="dourada"] { border:7px solid #c9a15a; box-shadow:0 0 0 2px rgba(201,161,90,.25), 0 4px 18px rgba(0,0,0,.35); }
.window { position:absolute; top:8%; left:8%; width:70px; height:84px; border:5px solid #fff; border-radius:10px; background:linear-gradient(#bfe3f2,#e6f5fb); box-shadow:0 2px 6px rgba(0,0,0,.08); }
.window::after { content:""; position:absolute; inset:0; background:linear-gradient(90deg,transparent 46%,#fff 46% 54%,transparent 54%), linear-gradient(0deg,transparent 46%,#fff 46% 54%,transparent 54%); }
.matt { position:absolute; bottom:6%; left:6%; width:34%; height:9%; background:#9dc3a6; border-radius:50%; opacity:.7; }
.treadmill { position:absolute; bottom:12%; right:6%; width:34%; height:26%; }
.rack { position:absolute; bottom:14%; left:38%; width:16%; height:20%; }
.decor { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.room[data-scene="ginasio"] .decor { display:none; }
.room[data-scene="parque"] .treadmill, .room[data-scene="parque"] .rack,
.room[data-scene="praia"] .treadmill, .room[data-scene="praia"] .rack,
.room[data-scene="noite"] .rack,
.room[data-scene="minimal"] .treadmill, .room[data-scene="minimal"] .rack,
.room[data-scene="minimal"] .window, .room[data-scene="minimal"] .matt { display:none; }
.room[data-scene="parque"] .window, .room[data-scene="praia"] .window { display:none; }
.avatar-rig { position:absolute; bottom:10%; left:50%; height:62%; aspect-ratio:.68; transform:translateX(-50%); animation:bob 3s ease-in-out infinite; z-index:2; }
.avatar { width:100%; height:100%; object-fit:contain; display:block; }
.overlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
@keyframes bob { 0%,100% { transform:translateX(-50%) translateY(0); } 50% { transform:translateX(-50%) translateY(-8px); } }
.card { position:absolute; top:12px; left:12px; background:var(--scene-card); border-radius:14px; padding:8px 12px; box-shadow:0 4px 14px rgba(35,61,48,.15); color:var(--scene-text); z-index:4; }
.namerow { display:flex; align-items:center; gap:8px; }
.name { font-weight:700; font-size:16px; }
.lv { background:var(--scene-primary); color:#fff; font-size:10px; font-weight:800; border-radius:999px; padding:2px 8px; }
.hearts { display:flex; gap:2px; margin-top:4px; }
.hearts svg { width:14px; height:14px; }
.xp { margin-top:6px; width:112px; height:6px; border-radius:999px; background:#e3e9e4; overflow:hidden; }
.xp > div { height:100%; background:var(--scene-primary); border-radius:999px; transition:width .4s; }
.bubble { position:absolute; bottom:12px; left:12px; max-width:70%; background:var(--scene-card); color:var(--scene-text); font-size:13px; font-weight:600; border-radius:14px 14px 14px 4px; padding:8px 12px; box-shadow:0 4px 14px rgba(35,61,48,.15); z-index:4; }
@media (prefers-reduced-motion: reduce) { .avatar-rig { animation:none; } }
</style>
<div class="room" role="img" aria-label="O teu companheiro num cenário de fitness" data-scene="ginasio">
  <div class="decor" aria-hidden="true"></div>
  <div class="window"></div>
  <div class="matt"></div>
  <svg class="rack" viewBox="0 0 60 70" aria-hidden="true">
    <rect x="4" y="10" width="6" height="56" rx="3" fill="#7a6a53"/>
    <rect x="50" y="10" width="6" height="56" rx="3" fill="#7a6a53"/>
    <rect x="0" y="18" width="60" height="6" rx="3" fill="#8d7c63"/>
    <rect x="0" y="42" width="60" height="6" rx="3" fill="#8d7c63"/>
    <circle cx="18" cy="21" r="8" fill="#4a5560"/><circle cx="42" cy="21" r="8" fill="#4a5560"/>
    <circle cx="18" cy="45" r="6" fill="#5d6b78"/><circle cx="42" cy="45" r="6" fill="#5d6b78"/>
  </svg>
  <svg class="treadmill" viewBox="0 0 120 90" aria-hidden="true">
    <rect x="6" y="58" width="108" height="16" rx="8" fill="#3d4750"/>
    <rect x="6" y="58" width="108" height="6" rx="3" fill="#57636e"/>
    <rect x="96" y="8" width="8" height="56" rx="4" fill="#3d4750"/>
    <rect x="76" y="4" width="40" height="14" rx="7" fill="#3d4750"/>
    <circle cx="86" cy="11" r="3" fill="#7ee0a3"/>
  </svg>
  <div class="avatar-rig">
    <img class="avatar" alt="" />
    <svg class="overlay" viewBox="0 0 200 300" aria-hidden="true"></svg>
  </div>
  <div class="card">
    <div class="namerow"><span class="name"></span><span class="lv"></span></div>
    <div class="hearts"></div>
    <div class="xp"><div></div></div>
  </div>
  <div class="bubble"></div>
</div>`;

const HEART_FULL = '<svg viewBox="0 0 24 24" fill="var(--scene-heart)"><path d="M12 21s-7.5-4.9-10-9.3C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.4h4C15 6.1 16.4 5 18.4 5c3.4 0 5.3 3.6 3.7 6.7C19.5 16.1 12 21 12 21z" transform="scale(0.9) translate(1.3,1.3)"/></svg>';
const HEART_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="#b9c6bd" stroke-width="2"><path d="M12 20s-6.7-4.4-9-8.3C1.6 8.9 3.3 5.8 6.3 5.8c1.8 0 3 .9 3.9 2.1h3.6c.9-1.2 2.1-2.1 3.9-2.1 3 0 4.7 3.1 3.3 5.9-2.3 3.9-9 8.3-9 8.3z"/></svg>';

export function hairMarkup(style, color) {
  if (style === 'careca') return '';
  const c = color;
  const cap = `<path d="M72 42 C70 18 84 7 100 7 C116 7 130 18 128 42 C120 33 112 29 100 29 C88 29 80 33 72 42 Z" fill="${c}" opacity=".82"/>`;
  const sides = `<path d="M74 38 C68 54 69 68 75 78 L82 73 C77 62 77 51 79 41 Z" fill="${c}" opacity=".72"/><path d="M126 38 C132 54 131 68 125 78 L118 73 C123 62 123 51 121 41 Z" fill="${c}" opacity=".72"/>`;
  if (style === 'medio') return cap + sides;
  if (style === 'longo') return cap + sides + `<path d="M72 52 C66 82 70 108 80 120 L89 114 C79 98 78 76 80 55 Z" fill="${c}" opacity=".68"/><path d="M128 52 C134 82 130 108 120 120 L111 114 C121 98 122 76 120 55 Z" fill="${c}" opacity=".68"/>`;
  if (style === 'rabo') return cap + `<path d="M124 34 C148 40 154 68 145 90 C151 70 144 53 126 44 Z" fill="${c}" opacity=".78"/>`;
  if (style === 'caracois') return cap + [[78,34],[88,20],[102,16],[116,21],[124,34],[72,44],[128,44]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}" opacity=".72"/>`).join('');
  return cap;
}

export function outfitMarkup(style, color) {
  const c = color;
  if (style === 'top') return `<path d="M73 84 C83 78 91 76 100 76 C109 76 117 78 127 84 L124 126 C115 131 85 131 76 126 Z" fill="${c}" opacity=".38"/>`;
  if (style === 'hoodie') return `<path d="M62 94 C70 82 84 76 100 76 C116 76 130 82 138 94 L146 150 L130 156 L128 112 L126 184 C114 190 86 190 74 184 L72 112 L70 156 L54 150 Z" fill="${c}" opacity=".42"/><path d="M79 90 C77 73 123 73 121 90" fill="none" stroke="${c}" stroke-width="8" opacity=".38" stroke-linecap="round"/>`;
  if (style === 'fato') return `<path d="M63 92 C72 82 86 77 100 77 C114 77 128 82 137 92 L142 146 L130 150 L128 116 L126 182 L110 184 L106 232 L92 232 L90 184 L74 182 L72 116 L70 150 L58 146 Z" fill="${c}" opacity=".40"/>`;
  return `<path d="M64 94 C73 83 86 78 100 78 C114 78 127 83 136 94 L130 118 L126 112 L128 182 C115 188 85 188 72 182 L74 112 L70 118 Z" fill="${c}" opacity=".38"/>`;
}

export function accessoryMarkup(accessory, color) {
  if (accessory === 'auscultadores') return `<path d="M62 54 C62 16 138 16 138 54" fill="none" stroke="#22272e" stroke-width="7" stroke-linecap="round"/><rect x="54" y="44" width="15" height="26" rx="7" fill="#2f3742"/><rect x="131" y="44" width="15" height="26" rx="7" fill="#2f3742"/>`;
  if (accessory === 'bone') return `<path d="M72 30 C76 8 124 8 128 30 L128 37 L72 37 Z" fill="${color}" opacity=".9"/><path d="M88 36 C100 32 122 32 142 39 C128 44 102 44 88 39 Z" fill="${color}" opacity=".85"/>`;
  if (accessory === 'sweatband') return `<path d="M72 25 C84 17 116 17 128 25 L127 35 C114 27 86 27 73 35 Z" fill="#e15b64" opacity=".9"/>`;
  if (accessory === 'oculos') return `<rect x="75" y="43" width="22" height="14" rx="7" fill="none" stroke="#1f252c" stroke-width="4"/><rect x="103" y="43" width="22" height="14" rx="7" fill="none" stroke="#1f252c" stroke-width="4"/><path d="M97 49 L103 49" stroke="#1f252c" stroke-width="3"/>`;
  if (accessory === 'toalha') return `<path d="M64 92 C76 84 88 82 98 88 L96 108 C86 112 74 108 66 100 Z" fill="#d8e4e8" opacity=".85"/><path d="M66 100 L62 146 L74 148 L78 106 Z" fill="#c8d8dc" opacity=".8"/>`;
  if (accessory === 'garrafa') return `<rect x="150" y="206" width="14" height="34" rx="5" fill="#4aa3c7"/><rect x="153" y="200" width="8" height="8" rx="3" fill="#2f3742"/>`;
  if (accessory === 'medalha') return `<path d="M92 84 L100 112 L108 84" fill="none" stroke="#c9a15a" stroke-width="4"/><circle cx="100" cy="118" r="9" fill="#c9a15a"/><circle cx="100" cy="118" r="5" fill="#e8c67a"/>`;
  return '';
}

function decorMarkup(scene) {
  const wrap = (inner) => `<svg viewBox="0 0 560 340" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">${inner}</svg>`;
  if (scene === 'parque') return wrap(`<circle cx="470" cy="62" r="34" fill="#f4d35e" opacity=".9"/><rect x="28" y="150" width="18" height="90" rx="7" fill="#6b4b32"/><circle cx="37" cy="132" r="58" fill="#5f925f"/><rect x="506" y="142" width="18" height="100" rx="7" fill="#6b4b32"/><circle cx="515" cy="124" r="68" fill="#4f7f4f"/><path d="M-20 292 Q 130 258 290 288 T 580 282 L580 360 L-20 360 Z" fill="#6c8a55" opacity=".55"/>`);
  if (scene === 'praia') return wrap(`<circle cx="448" cy="56" r="36" fill="#ffd166"/><path d="M0 150 Q 140 136 280 150 T 560 150 L560 206 L0 206 Z" fill="#5fa8bd" opacity=".9"/><path d="M0 236 Q 170 218 340 238 T 560 234" stroke="#f2e6c8" stroke-width="8" fill="none" opacity=".7"/>`);
  if (scene === 'noite') return wrap(`<g fill="#f4f1de">${[[70,44],[128,26],[190,58],[292,32],[380,54],[462,28],[518,66],[84,92],[420,94]].map(([x,y], i) => `<circle cx="${x}" cy="${y}" r="${1.4 + (i % 3) * .6}" opacity=".82"/>`).join('')}</g><circle cx="470" cy="48" r="24" fill="#f4f1de" opacity=".92"/><circle cx="482" cy="40" r="23" fill="#111827"/>`);
  if (scene === 'minimal') return wrap(`<rect x="108" y="178" width="356" height="3" rx="1.5" fill="#c6bfae" opacity=".5"/>`);
  return '';
}

export class CompanionScene extends HTMLElement {
  static observedAttributes = ['name', 'level', 'hearts', 'xp', 'message', 'gender', 'weight', 'body',
    'hue', 'brightness', 'asset-base', 'hair', 'hair-color', 'outfit', 'outfit-color',
    'accessory', 'scene', 'aura', 'frame'];
  constructor() {
    super();
    this.attachShadow({mode:'open'}).append(sceneTemplate.content.cloneNode(true));
  }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  get value() {
    const gender = this.getAttribute('gender') === 'man' ? 'man' : 'woman';
    const w = parseInt(this.getAttribute('weight') || '', 10);
    const body = this.getAttribute('body') === 'larger' ? 'larger' : 'slim';
    const base = this.getAttribute('asset-base') || SCENE_DEFAULT_ASSETS;
    const root = new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI);
    const file = !Number.isNaN(w) ? `${gender}-${sceneStageFor(w)}kg.webp` : `${gender}-${body}.webp`;
    return {
      name: this.getAttribute('name') || 'Mika',
      level: Math.max(1, parseInt(this.getAttribute('level') || '1', 10) || 1),
      hearts: Math.min(5, Math.max(0, parseInt(this.getAttribute('hearts') || '0', 10) || 0)),
      xp: Math.min(1, Math.max(0, parseFloat(this.getAttribute('xp') || '0') || 0)),
      message: this.getAttribute('message') || '',
      gender, weight: Number.isNaN(w) ? null : w, body,
      hue: parseFloat(this.getAttribute('hue') || '0') || 0,
      brightness: Math.min(150, Math.max(50, parseFloat(this.getAttribute('brightness') || '100') || 100)),
      hair: pick(this.getAttribute('hair'), HAIR_STYLES, 'curto'),
      hairColor: HAIR_COLORS[this.getAttribute('hair-color')] || HAIR_COLORS.castanho,
      outfit: pick(this.getAttribute('outfit'), OUTFIT_STYLES, 'tshirt'),
      outfitColor: OUTFIT_COLORS[this.getAttribute('outfit-color')] || OUTFIT_COLORS.teal,
      accessory: pick(this.getAttribute('accessory'), ACCESSORIES, 'none'),
      scene: pick(this.getAttribute('scene'), SCENES, 'ginasio'),
      aura: pick(this.getAttribute('aura'), AURAS, 'none'),
      frame: pick(this.getAttribute('frame'), FRAMES, 'none'),
      imageUrl: new URL(file, root).href,
    };
  }
  render() {
    if (!this.shadowRoot) return;
    const v = this.value;
    const img = this.shadowRoot.querySelector('.avatar');
    img.src = v.imageUrl;
    img.alt = `${v.name}, o teu companheiro de fitness`;
    img.style.filter = `hue-rotate(${v.hue}deg) brightness(${v.brightness}%)`;
    this.shadowRoot.querySelector('.overlay').innerHTML =
      outfitMarkup(v.outfit, v.outfitColor) + hairMarkup(v.hair, v.hairColor) +
      accessoryMarkup(v.accessory, v.outfitColor);
    const room = this.shadowRoot.querySelector('.room');
    room.dataset.scene = v.scene;
    room.dataset.aura = v.aura;
    room.dataset.frame = v.frame;
    room.setAttribute('aria-label', `O teu companheiro num cenário ${v.scene}`);
    this.shadowRoot.querySelector('.decor').innerHTML = decorMarkup(v.scene);
    this.shadowRoot.querySelector('.name').textContent = v.name;
    this.shadowRoot.querySelector('.lv').textContent = `Nv ${v.level}`;
    this.shadowRoot.querySelector('.hearts').innerHTML =
      Array.from({length:5}, (_,i) => i < v.hearts ? HEART_FULL : HEART_EMPTY).join('');
    this.shadowRoot.querySelector('.xp > div').style.width = `${v.xp * 100}%`;
    const bubble = this.shadowRoot.querySelector('.bubble');
    bubble.textContent = v.message;
    bubble.style.display = v.message ? '' : 'none';
  }
}
if (!customElements.get('companion-scene')) customElements.define('companion-scene', CompanionScene);
