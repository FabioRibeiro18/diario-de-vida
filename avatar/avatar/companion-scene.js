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

const sceneTemplate = document.createElement('template');
sceneTemplate.innerHTML = `
<style>
:host { --scene-wall:#e9f2ea; --scene-floor:#d8c9a8; --scene-card:#ffffff; --scene-text:#233d30; --scene-primary:#2d6849; --scene-heart:#e15b64; display:block; font-family:system-ui,sans-serif; max-width:560px; }
* { box-sizing:border-box; }
.room { position:relative; height:340px; border-radius:24px; overflow:hidden; background:linear-gradient(var(--scene-wall) 0 62%, var(--scene-floor) 62% 100%); }
.room::before { content:""; position:absolute; left:0; right:0; top:62%; height:6px; background:rgba(0,0,0,.08); }
.window { position:absolute; top:8%; left:8%; width:70px; height:84px; border:5px solid #fff; border-radius:10px; background:linear-gradient(#bfe3f2,#e6f5fb); box-shadow:0 2px 6px rgba(0,0,0,.08); }
.window::after { content:""; position:absolute; inset:0; background:linear-gradient(90deg,transparent 46%,#fff 46% 54%,transparent 54%), linear-gradient(0deg,transparent 46%,#fff 46% 54%,transparent 54%); }
.matt { position:absolute; bottom:6%; left:6%; width:34%; height:9%; background:#9dc3a6; border-radius:50%; opacity:.7; }
.treadmill { position:absolute; bottom:12%; right:6%; width:34%; height:26%; }
.rack { position:absolute; bottom:14%; left:38%; width:16%; height:20%; }
.avatar { position:absolute; bottom:10%; left:50%; transform:translateX(-50%); height:62%; object-fit:contain; animation:bob 3s ease-in-out infinite; }
@keyframes bob { 0%,100% { transform:translateX(-50%) translateY(0); } 50% { transform:translateX(-50%) translateY(-8px); } }
.card { position:absolute; top:12px; left:12px; background:var(--scene-card); border-radius:14px; padding:8px 12px; box-shadow:0 4px 14px rgba(35,61,48,.15); color:var(--scene-text); }
.namerow { display:flex; align-items:center; gap:8px; }
.name { font-weight:700; font-size:16px; }
.lv { background:var(--scene-primary); color:#fff; font-size:10px; font-weight:800; border-radius:999px; padding:2px 8px; }
.hearts { display:flex; gap:2px; margin-top:4px; }
.hearts svg { width:14px; height:14px; }
.xp { margin-top:6px; width:112px; height:6px; border-radius:999px; background:#e3e9e4; overflow:hidden; }
.xp > div { height:100%; background:var(--scene-primary); border-radius:999px; transition:width .4s; }
.bubble { position:absolute; bottom:12px; left:12px; max-width:70%; background:var(--scene-card); color:var(--scene-text); font-size:13px; font-weight:600; border-radius:14px 14px 14px 4px; padding:8px 12px; box-shadow:0 4px 14px rgba(35,61,48,.15); }
</style>
<div class="room" role="img" aria-label="O teu companheiro num mini ginásio">
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
  <img class="avatar" alt="" />
  <div class="card">
    <div class="namerow"><span class="name"></span><span class="lv"></span></div>
    <div class="hearts"></div>
    <div class="xp"><div></div></div>
  </div>
  <div class="bubble"></div>
</div>`;

const HEART_FULL = '<svg viewBox="0 0 24 24" fill="var(--scene-heart)"><path d="M12 21s-7.5-4.9-10-9.3C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.4h4C15 6.1 16.4 5 18.4 5c3.4 0 5.3 3.6 3.7 6.7C19.5 16.1 12 21 12 21z" transform="scale(0.9) translate(1.3,1.3)"/></svg>';
const HEART_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="#b9c6bd" stroke-width="2"><path d="M12 20s-6.7-4.4-9-8.3C1.6 8.9 3.3 5.8 6.3 5.8c1.8 0 3 .9 3.9 2.1h3.6c.9-1.2 2.1-2.1 3.9-2.1 3 0 4.7 3.1 3.3 5.9-2.3 3.9-9 8.3-9 8.3z"/></svg>';

export class CompanionScene extends HTMLElement {
  static observedAttributes = ['name', 'level', 'hearts', 'xp', 'message', 'gender', 'weight', 'body', 'hue', 'asset-base'];
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
      imageUrl: new URL(file, root).href,
    };
  }
  render() {
    if (!this.shadowRoot) return;
    const v = this.value;
    const img = this.shadowRoot.querySelector('.avatar');
    img.src = v.imageUrl;
    img.alt = `${v.name}, o teu companheiro de fitness`;
    img.style.filter = v.hue ? `hue-rotate(${v.hue}deg)` : '';
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
