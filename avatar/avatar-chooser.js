import { hairMarkup, outfitMarkup, accessoryMarkup, HAIR_COLORS as SCENE_HAIR_COLORS, OUTFIT_COLORS as SCENE_OUTFIT_COLORS } from './companion-scene.js';

const DEFAULT_ASSETS = new URL('./assets/', import.meta.url).href;
const STAGES = [100, 90, 80, 70]; // available weight-stage images (kg)
const MIN_KG = 60, MAX_KG = 110, STEP_KG = 10;

const DEFAULTS = {
  gender: 'woman', body: 'slim', weight: 80,
  hair: 'curto', hairColor: 'castanho',
  outfit: 'tshirt', outfitColor: 'teal',
  accessory: 'none', scene: 'ginasio',
  aura: 'none', frame: 'none', hue: 0, brightness: 100
};

const HAIR_STYLES = [
  ['curto', 'Curto'], ['medio', 'Médio'], ['longo', 'Longo'],
  ['rabo', 'Rabo de cavalo'], ['caracois', 'Caracóis'], ['careca', 'Careca']
];
const HAIR_COLORS = [
  ['castanho', 'Castanho', '#6b4b32'], ['preto', 'Preto', '#22201f'],
  ['loiro', 'Loiro', '#c9a15a'], ['ruivo', 'Ruivo', '#9b4a2f'],
  ['grisalho', 'Grisalho', '#9aa0a6'], ['azul', 'Azul', '#3b6fd4']
];
const OUTFITS = [
  ['tshirt', 'T-shirt'], ['hoodie', 'Hoodie'], ['top', 'Top desportivo'], ['fato', 'Fato de treino']
];
const OUTFIT_COLORS = [
  ['teal', 'Teal', '#2d9488'], ['escuro', 'Escuro', '#303843'],
  ['branco', 'Branco', '#e8ece9'], ['vermelho', 'Vermelho', '#b94a48'],
  ['azul', 'Azul', '#3b6fa8'], ['roxo', 'Roxo', '#7b5ea7']
];
const ACCESSORIES = [
  ['none', 'Nenhum'], ['auscultadores', 'Auscultadores'], ['bone', 'Boné'],
  ['sweatband', 'Sweatband'], ['oculos', 'Óculos'], ['toalha', 'Toalha'],
  ['garrafa', 'Garrafa'], ['medalha', 'Medalha']
];
const SCENES = [
  ['ginasio', 'Ginásio'], ['parque', 'Parque'], ['praia', 'Praia'],
  ['noite', 'Noite'], ['minimal', 'Minimal']
];
const AURAS = [['none', 'Nenhuma'], ['suave', 'Suave'], ['forte', 'Forte']];
const FRAMES = [['none', 'Nenhuma'], ['clara', 'Clara'], ['dourada', 'Dourada']];

// Map any weight in 60–110 kg to the closest available stage image.
function stageFor(kg) {
  if (kg >= 95) return 100;
  if (kg >= 85) return 90;
  if (kg >= 75) return 80;
  return 70;
}

function radios(name, options, current, labelPrefix) {
  return options.map(([value, label, color]) => `
    <label class="option${color ? ' colour' : ''}">
      <input type="radio" name="${name}" value="${value}" ${value === current ? 'checked' : ''} />
      <span>${color ? `<i style="--swatch:${color}"></i>` : ''}${labelPrefix ? labelPrefix + ' ' : ''}${label}</span>
    </label>`).join('');
}

const template = document.createElement('template');
template.innerHTML = `
<style>
:host { --avatar-bg: #f4f8f5; --avatar-surface: #ffffff; --avatar-text: #233d30; --avatar-primary: #2d6849; --avatar-border: #cbdacf; --avatar-focus: #2683cb; display:block; color:var(--avatar-text); font-family:system-ui,sans-serif; max-width:520px; }
* { box-sizing:border-box; }
section { padding:22px; background:var(--avatar-bg); border-radius:10px; }
h2 { margin:0 0 14px; font-size:22px; letter-spacing:0; }
.preview { position:relative; height:300px; display:flex; justify-content:center; align-items:flex-end; margin-bottom:16px; border-radius:14px; overflow:hidden; background:linear-gradient(#e9f2ea 0 62%, #d8c9a8 62% 100%); transition:background .3s; }
.preview[data-scene="parque"] { background:linear-gradient(#cfe8f2 0 55%, #9dc3a6 55% 70%, #c9b88f 70% 100%); }
.preview[data-scene="praia"] { background:linear-gradient(#bfe3f2 0 52%, #e8d8a8 52% 68%, #d9c49a 68% 100%); }
.preview[data-scene="noite"] { background:linear-gradient(#172033 0 62%, #2a2d3a 62% 100%); }
.preview[data-scene="minimal"] { background:linear-gradient(#f4f1ea 0 66%, #e6e1d6 66% 100%); }
.preview::after { content:""; position:absolute; left:0; right:0; bottom:0; height:38%; background:linear-gradient(transparent,rgba(0,0,0,.08)); pointer-events:none; }
.avatar-preview-rig { position:relative; height:290px; aspect-ratio:.68; z-index:2; flex:0 0 auto; }
.avatar-preview-rig img { display:block; width:100%; height:100%; object-fit:contain; transition:filter .2s; }
.avatar-preview-rig .overlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; z-index:3; }
.preview[data-aura="suave"] { box-shadow:inset 0 0 60px rgba(45,212,191,.30); }
.preview[data-aura="forte"] { box-shadow:inset 0 0 80px rgba(45,212,191,.55); }
.preview[data-frame="clara"] { border:8px solid rgba(255,255,255,.75); }
.preview[data-frame="dourada"] { border:8px solid #c9a15a; }
.auto-weight { margin:-4px 0 12px; padding:9px 11px; border:1px dashed var(--avatar-border); border-radius:8px; font-size:12px; line-height:1.5; }
.tabs { display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; margin-bottom:14px; }
.tabs::-webkit-scrollbar { height:4px; }
.tab { flex:0 0 auto; border:1px solid var(--avatar-border); background:var(--avatar-surface); color:inherit; border-radius:999px; padding:7px 12px; font:inherit; font-size:12px; font-weight:650; cursor:pointer; }
.tab[aria-selected="true"] { background:var(--avatar-primary); color:#fff; border-color:var(--avatar-primary); }
.tab:focus-visible, input:focus-visible + span { outline:3px solid var(--avatar-focus); outline-offset:2px; }
.panel[hidden] { display:none; }
fieldset { border:0; padding:0; margin:0 0 16px; }
legend { font-size:13px; font-weight:700; margin-bottom:8px; }
.options { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.option { position:relative; cursor:pointer; }
.option.locked { cursor:not-allowed; }
.option.locked > span { opacity:.5; padding-right:46px; }
.option.locked::after { content:'🔒 ' attr(data-lock); position:absolute; right:6px; top:50%; transform:translateY(-50%); font-size:9px; font-family:'JetBrains Mono',monospace; color:var(--avatar-primary); background:var(--avatar-bg); border:1px solid var(--avatar-border); border-radius:999px; padding:2px 5px; }
input[type=radio] { position:absolute; opacity:0; width:1px; height:1px; }
.option > span { display:flex; align-items:center; gap:7px; text-align:left; border:1px solid var(--avatar-border); background:var(--avatar-surface); border-radius:7px; padding:10px 9px; font-size:12px; font-weight:600; line-height:1.3; }
.option.colour > span { justify-content:flex-start; }
.option i { width:16px; height:16px; border-radius:50%; background:var(--swatch); border:2px solid #fff; box-shadow:0 0 0 1px var(--avatar-border); flex:0 0 auto; }
input:checked + span { border-color:var(--avatar-primary); color:var(--avatar-primary); box-shadow:inset 0 0 0 1px var(--avatar-primary); }
.weight { display:flex; align-items:center; gap:12px; }
input[type=range] { flex:1; accent-color:var(--avatar-primary); }
.kg { min-width:64px; text-align:center; border:1px solid var(--avatar-border); background:var(--avatar-surface); border-radius:6px; padding:8px 4px; font-weight:700; font-variant-numeric:tabular-nums; }
output { display:block; font-size:12px; text-align:center; margin-top:4px; color:#4a5a50; line-height:1.5; }
:host(:not([weight-slider])) .weightbox { display:none; }
@media(max-width:380px) { section { padding:15px; } .preview { height:250px; } .avatar-preview-rig { height:240px; } .options { grid-template-columns:1fr; } }
</style>
<section aria-label="Editor do avatar">
  <h2>O teu avatar</h2>
  <div class="preview" data-scene="ginasio">
    <div class="avatar-preview-rig">
      <img width="768" height="1024" alt="" />
      <svg class="overlay" viewBox="0 0 200 300" aria-hidden="true"></svg>
    </div>
  </div>
  <div class="auto-weight"></div>
  <div class="tabs" role="tablist" aria-label="Secções do avatar">
    <button type="button" class="tab" role="tab" id="tab-corpo" aria-controls="panel-corpo" aria-selected="true" data-tab="corpo">Corpo</button>
    <button type="button" class="tab" role="tab" id="tab-cabelo" aria-controls="panel-cabelo" aria-selected="false" data-tab="cabelo">Cabelo</button>
    <button type="button" class="tab" role="tab" id="tab-roupa" aria-controls="panel-roupa" aria-selected="false" data-tab="roupa">Roupa</button>
    <button type="button" class="tab" role="tab" id="tab-acessorios" aria-controls="panel-acessorios" aria-selected="false" data-tab="acessorios">Acessórios</button>
    <button type="button" class="tab" role="tab" id="tab-cenario" aria-controls="panel-cenario" aria-selected="false" data-tab="cenario">Cenário</button>
    <button type="button" class="tab" role="tab" id="tab-efeitos" aria-controls="panel-efeitos" aria-selected="false" data-tab="efeitos">Efeitos</button>
  </div>
  <div class="panel" role="tabpanel" id="panel-corpo" aria-labelledby="tab-corpo">
    <fieldset><legend>Género</legend><div class="options">${radios('gender', [['woman','Mulher'],['man','Homem']], DEFAULTS.gender)}</div></fieldset>
    <fieldset><legend>Corpo</legend><div class="options">${radios('body', [['slim','Magro'],['larger','Corpulento']], DEFAULTS.body)}</div></fieldset>
    <fieldset class="weightbox"><legend>Peso (aparência)</legend>
      <div class="weight">
        <input type="range" name="weight" min="${MIN_KG}" max="${MAX_KG}" step="${STEP_KG}" aria-label="Peso em quilogramas" />
        <span class="kg"></span>
      </div>
    </fieldset>
  </div>
  <div class="panel" role="tabpanel" id="panel-cabelo" aria-labelledby="tab-cabelo" hidden>
    <fieldset><legend>Estilo</legend><div class="options">${radios('hair', HAIR_STYLES, DEFAULTS.hair)}</div></fieldset>
    <fieldset><legend>Cor</legend><div class="options">${radios('hair-color', HAIR_COLORS, DEFAULTS.hairColor)}</div></fieldset>
  </div>
  <div class="panel" role="tabpanel" id="panel-roupa" aria-labelledby="tab-roupa" hidden>
    <fieldset><legend>Estilo</legend><div class="options">${radios('outfit', OUTFITS, DEFAULTS.outfit)}</div></fieldset>
    <fieldset><legend>Cor</legend><div class="options">${radios('outfit-color', OUTFIT_COLORS, DEFAULTS.outfitColor)}</div></fieldset>
  </div>
  <div class="panel" role="tabpanel" id="panel-acessorios" aria-labelledby="tab-acessorios" hidden>
    <fieldset><legend>Acessório</legend><div class="options">${radios('accessory', ACCESSORIES, DEFAULTS.accessory)}</div></fieldset>
  </div>
  <div class="panel" role="tabpanel" id="panel-cenario" aria-labelledby="tab-cenario" hidden>
    <fieldset><legend>Cenário</legend><div class="options">${radios('scene', SCENES, DEFAULTS.scene)}</div></fieldset>
  </div>
  <div class="panel" role="tabpanel" id="panel-efeitos" aria-labelledby="tab-efeitos" hidden>
    <fieldset><legend>Aura</legend><div class="options">${radios('aura', AURAS, DEFAULTS.aura)}</div></fieldset>
    <fieldset><legend>Moldura</legend><div class="options">${radios('frame', FRAMES, DEFAULTS.frame)}</div></fieldset>
    <fieldset><legend>Tom (hue)</legend>
      <input type="range" name="hue" min="-180" max="180" step="5" value="${DEFAULTS.hue}" aria-label="Tom do avatar" />
    </fieldset>
    <fieldset><legend>Brilho</legend>
      <input type="range" name="brightness" min="70" max="130" step="5" value="${DEFAULTS.brightness}" aria-label="Brilho do avatar" />
    </fieldset>
  </div>
  <output aria-live="polite"></output>
</section>`;

export class AvatarChooser extends HTMLElement {
  static observedAttributes = ['gender', 'body', 'weight', 'asset-base', 'weight-slider',
    'hair', 'hair-color', 'outfit', 'outfit-color', 'accessory', 'scene',
    'aura', 'frame', 'hue', 'brightness', 'locked'];
  constructor() {
    super();
    this.attachShadow({mode:'open'}).append(template.content.cloneNode(true));
    this.shadowRoot.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      this.setAttribute(input.name, input.value);
      this.dispatchEvent(new CustomEvent('avatar-change', {
        detail: this.value, bubbles: true, composed: true,
      }));
    });
    // Live preview while dragging sliders.
    this.shadowRoot.addEventListener('input', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && ['weight', 'hue', 'brightness'].includes(input.name)) {
        this.setAttribute(input.name, input.value);
      }
    });
    this.shadowRoot.querySelector('.tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.tab');
      if (tab) this.selectTab(tab.dataset.tab, true);
    });
    this.shadowRoot.querySelector('.tabs').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const tabs = Array.from(this.shadowRoot.querySelectorAll('.tab'));
      const idx = tabs.indexOf(this.shadowRoot.activeElement);
      if (idx < 0) return;
      event.preventDefault();
      const next = tabs[(idx + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      this.selectTab(next.dataset.tab, true);
    });
  }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  get weight() {
    const w = parseInt(this.getAttribute('weight') || '', 10);
    if (Number.isNaN(w)) return null;
    return Math.min(MAX_KG, Math.max(MIN_KG, w));
  }
  attr(name) {
    const v = this.getAttribute(name);
    return v === null || v === '' ? DEFAULTS[name] : v;
  }
  get value() {
    const gender = this.getAttribute('gender') === 'man' ? 'man' : 'woman';
    const body = this.getAttribute('body') === 'larger' ? 'larger' : 'slim';
    const weight = this.weight;
    const base = this.getAttribute('asset-base') || DEFAULT_ASSETS;
    const root = new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI);
    // Weight stage images take precedence when a weight is set.
    const file = weight !== null ? `${gender}-${stageFor(weight)}kg.webp` : `${gender}-${body}.webp`;
    const imageUrl = new URL(file, root).href;
    return {
      gender, body, weight, stage: weight !== null ? stageFor(weight) : null, imageUrl,
      hair: this.attr('hair'), hairColor: this.attr('hair-color'),
      outfit: this.attr('outfit'), outfitColor: this.attr('outfit-color'),
      accessory: this.attr('accessory'), scene: this.attr('scene'),
      aura: this.attr('aura'), frame: this.attr('frame'),
      hue: Number(this.attr('hue')) || 0, brightness: Number(this.attr('brightness')) || 100
    };
  }
  set value(selection) {
    if (!selection) return;
    this.setAttribute('gender', selection.gender === 'man' ? 'man' : 'woman');
    this.setAttribute('body', selection.body === 'larger' ? 'larger' : 'slim');
    if (selection.weight === null || selection.weight === undefined) this.removeAttribute('weight');
    else this.setAttribute('weight', String(selection.weight));
    const map = {
      hair: 'hair', hairColor: 'hair-color', outfit: 'outfit', outfitColor: 'outfit-color',
      accessory: 'accessory', scene: 'scene', aura: 'aura', frame: 'frame',
      hue: 'hue', brightness: 'brightness'
    };
    Object.keys(map).forEach(k => {
      if (selection[k] !== undefined && selection[k] !== null) this.setAttribute(map[k], String(selection[k]));
    });
  }
  selectTab(name, focus) {
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    this.shadowRoot.querySelectorAll('.panel').forEach(panel => {
      panel.hidden = panel.id !== 'panel-' + name;
    });
  }
  applyLocks() {
    const tokens = {};
    (this.getAttribute('locked') || '').split(',').filter(Boolean).forEach(token => {
      const [name, value, level] = token.split(':');
      if (name && value) tokens[name + ':' + value] = level;
    });
    this.shadowRoot.querySelectorAll('.option').forEach(label => {
      const input = label.querySelector('input[type=radio]');
      if (!input) return;
      const need = tokens[input.name + ':' + input.value];
      const locked = !!need && !input.checked;
      input.disabled = locked;
      label.classList.toggle('locked', locked);
      if (locked) {
        label.dataset.lock = 'Nv ' + need;
        label.title = 'Desbloqueia no nível ' + need;
      } else {
        label.removeAttribute('data-lock');
        label.removeAttribute('title');
      }
    });
  }
  render() {
    if (!this.shadowRoot) return;
    const v = this.value;
    const {gender, body, weight, imageUrl} = v;
    const genderLabel = gender === 'man' ? 'Homem' : 'Mulher';
    const bodyLabel = weight !== null ? `${weight} kg` : (body === 'slim' ? 'Magro' : 'Corpulento');
    this.shadowRoot.querySelectorAll('input[type=radio]').forEach((input) => {
      let current = null;
      if (input.name === 'gender') current = gender;
      else if (input.name === 'body') current = body;
      else if (input.name === 'hair') current = v.hair;
      else if (input.name === 'hair-color') current = v.hairColor;
      else if (input.name === 'outfit') current = v.outfit;
      else if (input.name === 'outfit-color') current = v.outfitColor;
      else if (input.name === 'accessory') current = v.accessory;
      else if (input.name === 'scene') current = v.scene;
      else if (input.name === 'aura') current = v.aura;
      else if (input.name === 'frame') current = v.frame;
      input.checked = input.value === current;
    });
    const slider = this.shadowRoot.querySelector('input[type=range][name=weight]');
    if (slider) slider.value = String(weight !== null ? weight : 85);
    const kg = this.shadowRoot.querySelector('.kg');
    if (kg) kg.textContent = weight !== null ? `${weight} kg` : '—';
    const hue = this.shadowRoot.querySelector('input[type=range][name=hue]');
    if (hue) hue.value = String(v.hue);
    const brightness = this.shadowRoot.querySelector('input[type=range][name=brightness]');
    if (brightness) brightness.value = String(v.brightness);
    const rig = this.shadowRoot.querySelector('.avatar-preview-rig');
    const image = this.shadowRoot.querySelector('img');
    image.src = imageUrl;
    image.alt = weight !== null
      ? `Avatar de fitness (${genderLabel}) com cerca de ${weight} quilos`
      : `Avatar de fitness (${genderLabel})`;
    rig.style.filter = `hue-rotate(${v.hue}deg) brightness(${v.brightness}%)`;
    const hairColorHex = SCENE_HAIR_COLORS[v.hairColor] || SCENE_HAIR_COLORS.castanho;
    const outfitColorHex = SCENE_OUTFIT_COLORS[v.outfitColor] || SCENE_OUTFIT_COLORS.teal;
    this.shadowRoot.querySelector('.overlay').innerHTML =
      outfitMarkup(v.outfit, outfitColorHex) + hairMarkup(v.hair, hairColorHex) +
      accessoryMarkup(v.accessory, outfitColorHex);
    const preview = this.shadowRoot.querySelector('.preview');
    preview.dataset.scene = v.scene;
    preview.dataset.aura = v.aura;
    preview.dataset.frame = v.frame;
    const auto = this.shadowRoot.querySelector('.auto-weight');
    if (auto) auto.textContent = weight !== null
      ? `Peso automático: ${weight} kg, a partir do último registo.`
      : 'Sem peso registado. Usa 80 kg como referência.';
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    });
    this.shadowRoot.querySelector('output').textContent =
      `${genderLabel} — ${bodyLabel} — ${v.hair} — ${v.outfit} — ${v.scene}`;
    this.applyLocks();
  }
}
if (!customElements.get('avatar-chooser')) customElements.define('avatar-chooser', AvatarChooser);
