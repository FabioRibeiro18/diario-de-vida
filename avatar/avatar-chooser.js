const DEFAULT_ASSETS = new URL('./assets/', import.meta.url).href;
const STAGES = [100, 90, 80, 70]; // available weight-stage images (kg)
const MIN_KG = 60, MAX_KG = 110, STEP_KG = 10;

// Map any weight in 60–110 kg to the closest available stage image.
function stageFor(kg) {
  if (kg >= 95) return 100;
  if (kg >= 85) return 90;
  if (kg >= 75) return 80;
  return 70;
}

const template = document.createElement('template');
template.innerHTML = `
<style>
:host { --avatar-bg: #f4f8f5; --avatar-surface: #ffffff; --avatar-text: #233d30; --avatar-primary: #2d6849; --avatar-border: #cbdacf; --avatar-focus: #2683cb; display:block; color:var(--avatar-text); font-family:system-ui,sans-serif; max-width:440px; }
* { box-sizing:border-box; }
section { padding:24px; background:var(--avatar-bg); border-radius:8px; }
h2 { margin:0 0 16px; font-size:24px; letter-spacing:0; }
.preview { height:320px; display:flex; justify-content:center; margin-bottom:20px; }
img { width:240px; height:320px; object-fit:contain; }
fieldset { border:0; padding:0; margin:0 0 16px; }
legend { font-size:14px; font-weight:650; margin-bottom:8px; }
.options { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
label { position:relative; cursor:pointer; }
input[type=radio] { position:absolute; opacity:0; width:1px; height:1px; }
span { display:block; text-align:center; border:1px solid var(--avatar-border); background:var(--avatar-surface); border-radius:6px; padding:12px 8px; font-weight:600; }
input:checked + span { border-color:var(--avatar-primary); color:var(--avatar-primary); box-shadow:inset 0 0 0 1px var(--avatar-primary); }
input:focus-visible + span { outline:3px solid var(--avatar-focus); outline-offset:3px; }
.weight { display:flex; align-items:center; gap:12px; }
input[type=range] { flex:1; accent-color:var(--avatar-primary); }
input[type=range]:focus-visible { outline:3px solid var(--avatar-focus); outline-offset:3px; }
.kg { min-width:64px; text-align:center; border:1px solid var(--avatar-border); background:var(--avatar-surface); border-radius:6px; padding:8px 4px; font-weight:700; font-variant-numeric:tabular-nums; }
output { display:block; font-size:14px; text-align:center; margin-top:8px; }
:host(:not([weight-slider])) .weightbox { display:none; }
@media(max-width:360px) { section { padding:16px; } .preview { height:280px; } img { width:210px; height:280px; } }
</style>
<section aria-label="Escolher avatar">
<h2>O teu avatar</h2>
<div class="preview"><img width="768" height="1024" alt="" /></div>
<fieldset><legend>Género</legend><div class="options">
<label><input type="radio" name="gender" value="woman" /><span>Mulher</span></label>
<label><input type="radio" name="gender" value="man" /><span>Homem</span></label>
</div></fieldset>
<fieldset class="weightbox"><legend>Peso (aparência)</legend>
<div class="weight">
<input type="range" name="weight" min="${MIN_KG}" max="${MAX_KG}" step="${STEP_KG}" aria-label="Peso em quilogramas" />
<span class="kg"></span>
</div>
</fieldset>
<output aria-live="polite"></output>
</section>`;

export class AvatarChooser extends HTMLElement {
  static observedAttributes = ['gender', 'body', 'weight', 'asset-base', 'weight-slider'];
  constructor() {
    super();
    this.attachShadow({mode:'open'}).append(template.content.cloneNode(true));
    this.shadowRoot.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      this.setAttribute(input.name, input.value);
      this.dispatchEvent(new CustomEvent('avatar-change', {
        detail:this.value, bubbles:true, composed:true,
      }));
    });
    // Live preview while dragging the weight slider.
    this.shadowRoot.addEventListener('input', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.name === 'weight') {
        this.setAttribute('weight', input.value);
      }
    });
  }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  get weight() {
    const w = parseInt(this.getAttribute('weight') || '', 10);
    if (Number.isNaN(w)) return null;
    return Math.min(MAX_KG, Math.max(MIN_KG, w));
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
    return { gender, body, weight, stage: weight !== null ? stageFor(weight) : null, imageUrl };
  }
  set value(selection) {
    this.setAttribute('gender', selection.gender === 'man' ? 'man' : 'woman');
    this.setAttribute('body', selection.body === 'larger' ? 'larger' : 'slim');
    if (selection.weight === null || selection.weight === undefined) this.removeAttribute('weight');
    else this.setAttribute('weight', String(selection.weight));
  }
  render() {
    if (!this.shadowRoot) return;
    const {gender, body, weight, imageUrl} = this.value;
    const genderLabel = gender === 'man' ? 'Homem' : 'Mulher';
    const bodyLabel = weight !== null ? `${weight} kg` : (body === 'slim' ? 'Magro' : 'Corpulento');
    this.shadowRoot.querySelectorAll('input[type=radio]').forEach((input) => {
      input.checked = input.value === (input.name === 'gender' ? gender : body);
    });
    const slider = this.shadowRoot.querySelector('input[type=range]');
    slider.value = String(weight !== null ? weight : 85);
    this.shadowRoot.querySelector('.kg').textContent = weight !== null ? `${weight} kg` : '—';
    const image = this.shadowRoot.querySelector('img');
    image.src = imageUrl;
    image.alt = weight !== null
      ? `Avatar de fitness (${genderLabel}) com cerca de ${weight} quilos`
      : `Avatar de fitness (${genderLabel})`;
    this.shadowRoot.querySelector('output').textContent = `${genderLabel} · ${bodyLabel}`;
  }
}
if (!customElements.get('avatar-chooser')) customElements.define('avatar-chooser', AvatarChooser);
