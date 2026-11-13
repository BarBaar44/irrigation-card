/*
 * Irrigation Card
 * A Lovelace card for a garden watering valve with a soil moisture sensor: a
 * line drawing (tap on a brick pier, valve, hose, raised vegetable bed with the
 * soil sensor) in the style of the Gardenview House card, soil moisture against
 * the target, a short status line, warnings, the season switch (the watering
 * automation), Water now and Stop, and steppers for the target and run time.
 * Tap opens a details pop-up with everything else.
 *
 * The card only reads the valve, sensors and helpers. Its actions are
 * switch.turn_on / turn_off, timer.start / cancel, input_number.set_value and
 * automation.turn_on / turn_off, all through Home Assistant's own action
 * handler (hass-action, perform-action); nothing calls hass directly.
 *
 * https://github.com/BarBaar44/irrigation-card  (MIT)
 */

// Everything sits in one block so the top-level names cannot clash with the
// sister cards when the files are loaded as classic scripts.
{
const VERSION = "0.1.1";

const IR_HOLD_MS = 500;
const IR_MOVE_PX = 8;
const IR_TICK_MS = 60000; // "2 h ago", stale sensor, night window follow the clock
const IR_FAST_MS = 1000; // countdown while watering
const IR_PENDING_MS = 4000; // a stepper value shown before HA confirms it
const IR_RECENT_MS = 12 * 3600000; // "Watered 03:15 · 42 L" for this long after a run

const IR_DEFAULTS = {
  name: "Garden irrigation",
  window_start: "03:00", // the automation's night window, for the status line only
  window_end: "06:00",
  low_battery: 15, // %, valve and soil sensor
  stale_after: 6, // hours without any update from the soil sensor
  water_now: "season", // "season": Water now only while the automation is on (it closes the valve when the timer ends); "always"
  entities: {
    valve: "switch.watervalve_balcony",
    valve_open: "binary_sensor.watervalve_balcony_valve_work_state",
    valve_status: "sensor.watervalve_balcony_current_device_status",
    auto_close: "switch.watervalve_balcony_auto_close_when_water_shortage",
    flow: "sensor.watervalve_balcony_flow",
    run_duration: "sensor.watervalve_balcony_real_time_irrigation_duration",
    run_volume: "sensor.watervalve_balcony_real_time_irrigation_volume",
    daily_volume: "sensor.watervalve_balcony_daily_irrigation_volume",
    run_start: "sensor.watervalve_balcony_irrigation_start_time",
    run_end: "sensor.watervalve_balcony_irrigation_end_time",
    valve_battery: "sensor.watervalve_balcony_battery",
    moisture: "sensor.soil_sensor_vegtable_garden_1_moisture",
    conductivity: "sensor.soil_sensor_vegtable_garden_1_conductivity",
    soil_temperature: "sensor.soil_sensor_vegtable_garden_1_temperature",
    illuminance: "sensor.soil_sensor_vegtable_garden_1_illuminance",
    soil_battery: "sensor.soil_sensor_vegtable_garden_1_battery",
    target: "input_number.soil_balcony_value",
    run_time: "input_number.watervalve_balcony_timer_value",
    timer: "timer.watervalve_balcony",
    last_started: "input_datetime.balconyvalvelaststarted",
    automation: "automation.balcony_valve",
    sun: "sun.sun",
  },
};

/* colors key -> CSS variable and default. */
const IR_COLORS = {
  water: ["--ir-water", "var(--blue-color, #2196f3)"],
  on: ["--ir-on", "var(--green-color, #4caf50)"],
  warn: ["--ir-warn", "var(--amber-color, #ffc107)"],
};

const IR_SOIL_ROLES = ["moisture", "conductivity", "soil_temperature", "illuminance", "soil_battery"];
const IR_BAD = ["unknown", "unavailable", "none", ""];
const irNum = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const irKey = (v) => String(v == null ? "" : v).trim().toLowerCase();
const irF = (n) => (Math.round(n * 100) / 100).toString();
const irTime = (v) => /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v));
const irHM = (v) => { const [h, m] = String(v).split(":"); return `${h.padStart(2, "0")}:${m}`; };
const irEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ------------------------------------------------------------------------ */
/* The drawing                                                              */
/* ------------------------------------------------------------------------ */

const irMix = (c1, c2, t) => {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1);
  const b = p(c2);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
};

/*
 * The picture as SVG markup for one state, 112 high and w (191 or 128) wide:
 * { w, moist, dry, open, night, shortage, valveLow, soilLow, stale, off }
 * Line art like the Gardenview House card: white surfaces, #111 outlines,
 * softened red brick. The soil darkens with moisture; water runs through the
 * hose and drips onto the bed while the valve is open.
 */
function irScene(o) {
  const W = o.w;
  const g = (c) => (o.night ? irMix(c, "#202020", 0.35) : c);
  const m = o.moist === null ? 30 : o.moist;
  const soil = irMix("#c2a083", "#4a3226", Math.max(0, Math.min(1, m / 70)));
  const wide = W > 150;
  const bx = wide ? 70 : 52;
  const bw = wide ? 104 : 62;
  const fy = 80;
  const by = 99;
  const d = 8;
  let s = "";
  // ground shadow
  s += `<path d="M4 107 L${W - 4} 107 L${W - 16} 99 L16 99Z" fill="#000" opacity=".28"/>`;
  // brick pier: front, mortar, side, cap, white edge
  const mortar = g("#e2b8ad");
  s += `<rect x="8" y="8" width="28" height="93" fill="${g("#c98f80")}" stroke="#111" stroke-width=".8"/>`;
  for (let y = 14; y < 100; y += 6) s += `<line x1="8" y1="${y}" x2="36" y2="${y}" stroke="${mortar}" stroke-width=".45"/>`;
  for (let y = 8, i = 0; y < 100; y += 6, i++) {
    for (const x of i % 2 ? [17, 27] : [12, 22, 32]) s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 6}" stroke="${mortar}" stroke-width=".45"/>`;
  }
  s += `<path d="M36 8 L42 4 L42 97 L36 101Z" fill="${g("#a8705f")}" stroke="#111" stroke-width=".8"/>`;
  s += `<path d="M8 8 L14 4 L42 4 L36 8Z" fill="${g("#ffffff")}" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`;
  s += `<line x1="36" y1="8" x2="36" y2="101" stroke="${g("#ffffff")}" stroke-width="2"/>`;
  // tap: wall plate, lever (turned while open), spout
  s += `<rect x="15" y="31" width="10" height="9" rx="1.5" fill="${g("#ffffff")}" stroke="#111" stroke-width="1.3"/>`;
  s += `<path d="M20 31 V25 M15.5 25 H24.5" stroke="#111" stroke-width="2" stroke-linecap="round"${o.open ? ' transform="rotate(-35 20 25)"' : ""}/>`;
  s += `<path d="M25 35.5 H31 V41" fill="none" stroke="#111" stroke-width="3.2" stroke-linejoin="round"/>`;
  // valve with its LED: red on shortage, blue while open, green otherwise
  const led = o.shortage ? "#f44336" : o.open ? "#29b6f6" : "#66bb6a";
  s += `<rect x="25" y="41" width="12" height="15" rx="2.5" fill="${g("#ffffff")}" stroke="#111" stroke-width="1.3"/>`;
  s += `<circle class="led" cx="31" cy="46" r="1.6" fill="${led}" stroke="#111" stroke-width=".5"/>`;
  if (o.valveLow) s += `<circle class="lowbat" cx="35" cy="53" r="1.5" fill="#ffc107" stroke="#111" stroke-width=".4"/>`;
  s += `<rect x="29" y="56" width="4" height="3.5" fill="#111"/>`;
  // raised bed: soil on top
  s += `<path class="soil" d="M${bx} ${fy} L${bx + bw} ${fy} L${bx + bw + d} ${fy - d} L${bx + d} ${fy - d}Z" fill="${soil}" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`;
  // plants, a little yellow below the target
  const leaf = o.dry ? g("#a5b55a") : g("#7cb342");
  const plant = (x, y, k) => {
    const L = (dx, dy) => {
      const sg = Math.sign(dx) || 1;
      return `<path d="M${irF(x)} ${irF(y)} Q${irF(x + dx * 0.2 - 3 * sg)} ${irF(y + dy * 0.6)} ${irF(x + dx)} ${irF(y + dy)} Q${irF(x + dx * 0.7 + 3 * sg)} ${irF(y + dy * 0.2)} ${irF(x)} ${irF(y)}Z" fill="${leaf}" stroke="#111" stroke-width="1"/>`;
    };
    return L(-9 * k, -10 * k) + L(9 * k, -11 * k) + L(-2 * k, -17 * k) + L(5 * k, -15 * k);
  };
  const px = wide ? [bx + 22, bx + 48, bx + 74] : [bx + 18, bx + 42];
  px.forEach((x, i) => { s += plant(x, fy - 3, i === 1 ? 1.15 : 0.95); });
  // soil sensor stick (grey while silent)
  const mx = bx + bw - 6;
  const body = o.stale ? g("#9e9e9e") : g("#ffffff");
  s += `<rect x="${mx}" y="${fy - 18}" width="4" height="14" fill="${body}" stroke="#111" stroke-width="1"/>`;
  s += `<rect x="${mx - 1.5}" y="${fy - 25}" width="7" height="8" rx="1.8" fill="${body}" stroke="#111" stroke-width="1.2"/>`;
  if (o.soilLow || o.stale) s += `<circle class="lowbat" cx="${mx + 2}" cy="${fy - 21}" r="1.4" fill="#ffc107"/>`;
  // bed front and side (wood)
  s += `<rect x="${bx}" y="${fy}" width="${bw}" height="${by - fy}" fill="${g("#c69c6d")}" stroke="#111" stroke-width="1.3"/>`;
  s += `<line x1="${bx}" y1="${(fy + by) / 2}" x2="${bx + bw}" y2="${(fy + by) / 2}" stroke="${g("#8d6e4f")}" stroke-width=".8"/>`;
  s += `<path d="M${bx + bw} ${fy} L${bx + bw + d} ${fy - d} L${bx + bw + d} ${by - d} L${bx + bw} ${by}Z" fill="${g("#a57f55")}" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>`;
  // hose: down from the valve, along the ground, over the edge onto the soil
  const ex = bx + 14;
  const ey = fy - 5;
  const hose = `M31 59.5 V90 Q31 102 43 102 H${bx - 8} Q${bx - 2} 102 ${bx - 2} 94 V${fy + 2} Q${bx - 2} ${fy - 4} ${bx + 4} ${ey} H${ex}`;
  s += `<path d="${hose}" fill="none" stroke="#111" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${hose}" fill="none" stroke="${g(o.off ? "#7a8a6e" : "#43a047")}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (o.open) {
    s += `<path class="flow" d="${hose}" fill="none" stroke="#81d4fa" stroke-width="1.6" stroke-dasharray="2.5 5" stroke-linecap="round"/>`;
    s += `<ellipse cx="${ex + 7}" cy="${ey + 1}" rx="9" ry="2.6" fill="#3e2a20" opacity=".55"/>`;
    for (let i = 0; i < 3; i++) s += `<path class="drop d${i}" d="M${ex + 3.5} ${ey - 2} q1.8 2.6 0 3.6 q-1.8 -1 0 -3.6Z" fill="#4fc3f7" stroke="#111" stroke-width=".6"/>`;
  }
  if (o.night) s += `<path class="moon" d="M${W - 14} 10 a9 9 0 1 0 8 13 a7 7 0 1 1 -8 -13Z" fill="#e8eef2" stroke="#111" stroke-width=".8"/>`;
  if (o.shortage) {
    s += `<g class="alert" transform="translate(40 30)"><circle r="7" fill="#ffc107" stroke="#111" stroke-width="1"/><path d="M0 -3.6 V1" stroke="#111" stroke-width="2" stroke-linecap="round"/><circle cy="3.4" r="1.1" fill="#111"/></g>`;
  }
  return `<svg viewBox="0 0 ${W} 112" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

/* ------------------------------------------------------------------------ */
/* The card                                                                 */
/* ------------------------------------------------------------------------ */

const IR_STYLE = `
  :host {
${Object.values(IR_COLORS).map(([v, d]) => `    ${v}: ${d};`).join("\n")}
  }
  ha-card {
    height: 100%; box-sizing: border-box; overflow: hidden; container-type: inline-size;
    display: flex; flex-direction: column;
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .top { flex: none; height: 120px; box-sizing: border-box; padding: 4px 12px 4px 6px; display: flex; align-items: center; gap: 10px; }
  .pic { flex: none; height: 112px; cursor: pointer; }
  .pic > div { height: 100%; }
  .pic svg { height: 100%; display: block; overflow: visible; }
  .pic .narrow { display: none; }
  @container (max-width: 419px) { .pic .wide { display: none; } .pic .narrow { display: block; } }
  .off .pic { filter: saturate(.35); opacity: .85; }

  .txt { flex: 1; min-width: 0; container-type: inline-size; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
  .name { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.warn { color: var(--ir-warn); }
  .big { font-size: 28px; font-weight: 500; letter-spacing: -.5px; line-height: 32px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .big small { font-size: 14px; font-weight: 400; letter-spacing: 0; color: var(--secondary-text-color); margin-left: 3px; }
  .big.word { font-size: 21px; }
  @container (max-width: 112px) { .big.word { font-size: 18px; } .big { font-size: 26px; } }
  .bar { position: relative; height: 6px; border-radius: 3px; background: var(--secondary-background-color, rgba(127,127,127,.15)); margin: 3px 0; max-width: 180px; }
  .bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--ir-water); transition: width .4s; }
  .bar b { position: absolute; top: -3px; width: 2px; height: 12px; margin-left: -1px; border-radius: 1px; background: var(--primary-text-color); }
  .line .s { display: none; }
  @container (max-width: 199px) { .line .l { display: none; } .line .s { display: inline; } }
  .line { font-size: 12px; line-height: 16px; min-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

  .btns { display: flex; flex-direction: column; gap: 4px; flex: none; }
  button {
    width: 32px; height: 32px; padding: 0; border: none; border-radius: 10px; cursor: pointer; font: inherit;
    display: flex; align-items: center; justify-content: center;
    background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--primary-text-color);
  }
  button ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; display: flex; }
  button:disabled { opacity: .28; cursor: default; }
  button.on { background: color-mix(in srgb, var(--ir-on) 25%, transparent); color: var(--ir-on); }
  button.run { background: color-mix(in srgb, var(--ir-water) 25%, transparent); color: var(--ir-water); }
  button:focus-visible { outline: 2px solid var(--primary-color); }

  .ctl { flex: 1; min-height: 0; box-sizing: border-box; padding: 0 12px 12px; display: flex; gap: 8px; align-items: center; }
  .step { flex: 1; min-width: 0; height: 40px; display: flex; align-items: center; border-radius: 12px; background: var(--secondary-background-color, rgba(127,127,127,.15)); }
  .step button { background: none; width: 40px; height: 40px; flex: none; border-radius: 12px; }
  .step .v { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 15px; font-weight: 500; color: var(--primary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
  .step .v ha-icon { --mdc-icon-size: 16px; width: 16px; height: 16px; display: flex; flex: none; color: var(--secondary-text-color); }
  .step .v small { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  @container (max-width: 359px) { .step .v ha-icon { display: none; } }
  ha-card.unavailable .pic { filter: grayscale(1); opacity: .45; }

  .flow { animation: ir-flow .6s linear infinite; }
  @keyframes ir-flow { to { stroke-dashoffset: -7.5; } }
  .drop { animation: ir-drop 1.2s ease-in infinite; }
  .d1 { animation-delay: .4s; } .d2 { animation-delay: .8s; }
  @keyframes ir-drop { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(5px); opacity: 0; } }

  dialog {
    border: none; padding: 0; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 64px); box-sizing: border-box;
    border-radius: var(--ha-card-border-radius, 12px); background: var(--card-background-color, #fff); color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, inherit); overflow: auto;
  }
  dialog:focus { outline: none; }
  dialog::backdrop { background: rgba(0,0,0,.5); }
  .dh { display: flex; align-items: center; gap: 8px; padding: 12px 8px 4px 16px; }
  .dh .t { flex: 1; font-size: 18px; font-weight: 500; }
  .dh button { background: none; }
  .ds { padding: 0 8px 12px; }
  .ds h3 { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); margin: 12px 8px 2px; }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 36px; padding: 0 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .row:hover { background: var(--secondary-background-color, rgba(127,127,127,.1)); }
  .row span:last-child { color: var(--primary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
  .row span:first-child { color: var(--secondary-text-color); }
  .row.warn span:last-child { color: var(--ir-warn); }
  .note { font-size: 12px; color: var(--secondary-text-color); padding: 4px 16px 12px; }

  @media (prefers-reduced-motion: reduce) {
    .flow, .drop { animation: none !important; }
    .bar i { transition: none !important; }
  }
`;

class IrrigationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._seen = Object.create(null);
    this._ids = [];
    this._tick = null;
    this._fast = null;
    this._pending = Object.create(null); // role -> { value, until }: stepper value not yet confirmed
  }

  static getConfigElement() {
    return document.createElement("irrigation-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 12, rows: 3, min_columns: 6, min_rows: 3 };
  }

  setConfig(config) {
    const c = config || {};
    const known = ["type", "name", "entities", "window_start", "window_end", "low_battery", "stale_after", "water_now",
      "tap_action", "hold_action", "colors", "grid_options", "layout_options", "view_layout", "visibility", "card_mod"];
    for (const k of Object.keys(c)) {
      if (!known.includes(k)) throw new Error(`Unknown option '${k}'. Known: ${known.slice(1, 11).join(", ")}`);
    }
    const ent = c.entities == null ? {} : c.entities;
    if (typeof ent !== "object" || Array.isArray(ent)) throw new Error("entities must be a map, e.g. valve: switch.my_valve");
    for (const [k, v] of Object.entries(ent)) {
      if (!(k in IR_DEFAULTS.entities)) {
        throw new Error(`entities: unknown role '${k}'. Known: ${Object.keys(IR_DEFAULTS.entities).join(", ")}`);
      }
      if (v !== null && (typeof v !== "string" || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(v))) {
        throw new Error(`entities.${k}: '${v}' is not an entity id (null switches it off)`);
      }
    }
    const entities = { ...IR_DEFAULTS.entities, ...ent };
    if (!entities.valve) throw new Error("entities.valve is required");

    const number = (k, min, max) => {
      const v = c[k] === undefined || c[k] === null ? IR_DEFAULTS[k] : irNum(c[k]);
      if (v === null || v < min || v > max) throw new Error(`${k} must be a number from ${min} to ${max}`);
      return v;
    };
    const time = (k) => {
      const v = c[k] === undefined || c[k] === null ? IR_DEFAULTS[k] : c[k];
      if (!irTime(v)) throw new Error(`${k} must be a time like 03:00`);
      return irHM(v);
    };
    const waterNow = c.water_now == null ? IR_DEFAULTS.water_now : c.water_now;
    if (!["season", "always"].includes(waterNow)) throw new Error("water_now must be season or always");
    if (c.colors != null && (typeof c.colors !== "object" || Array.isArray(c.colors))) {
      throw new Error("colors must be a map, e.g. water: dodgerblue");
    }
    for (const k of ["tap_action", "hold_action"]) {
      if (c[k] != null && (typeof c[k] !== "object" || Array.isArray(c[k]) || !c[k].action)) {
        throw new Error(`${k} must be an action, e.g. action: more-info`);
      }
    }

    this._config = {
      name: c.name == null ? IR_DEFAULTS.name : String(c.name),
      entities,
      start: time("window_start"),
      end: time("window_end"),
      lowBattery: number("low_battery", 0, 100),
      staleMs: number("stale_after", 1, 168) * 3600000,
      waterNow,
      tap_action: c.tap_action || null, // null: the card's own details pop-up
      hold_action: c.hold_action || { action: "more-info" },
      colors: c.colors || {},
    };
    this._applyColors(this._config.colors);
    this._ids = Object.values(entities).filter(Boolean);
    this._seen = Object.create(null);
    this._pending = Object.create(null);
    this._build();
    if (this._hass) this._update();
  }

  _applyColors(colors) {
    Object.keys(colors).forEach((k) => {
      if (!IR_COLORS[k]) console.warn(`irrigation-card: unknown colors key "${k}". Known: ${Object.keys(IR_COLORS).join(", ")}`);
    });
    Object.entries(IR_COLORS).forEach(([k, [v]]) => {
      const val = typeof colors[k] === "string" && colors[k].trim() ? colors[k].trim() : null;
      if (val) this.style.setProperty(v, val);
      else this.style.removeProperty(v);
    });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = first;
    for (const id of this._ids) {
      const s = hass.states[id];
      if (s !== this._seen[id]) {
        this._seen[id] = s;
        changed = true;
      }
    }
    if (changed) this._update();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    clearInterval(this._tick);
    this._tick = setInterval(() => this._update(), IR_TICK_MS);
    if (this._hass) this._update();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._tick = null;
    clearInterval(this._fast);
    this._fast = null;
  }

  _now() {
    return Date.now();
  }

  /* ---- DOM, built once per config ---------------------------------------- */

  _build() {
    const en = this._config.entities;
    const stepper = (cls, icon, label) => `
      <div class="step ${cls}">
        <button class="dn" aria-label="Lower ${label}"><ha-icon icon="mdi:minus"></ha-icon></button>
        <div class="v"><ha-icon icon="${icon}"></ha-icon><span></span><small></small></div>
        <button class="upb" aria-label="Raise ${label}"><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>`;
    this.shadowRoot.innerHTML = `
      <style>${IR_STYLE}</style>
      <ha-card>
        <div class="top">
          <div class="pic" role="img"><div class="wide"></div><div class="narrow"></div></div>
          <div class="txt" role="button" tabindex="0">
            <div class="name"></div>
            <div class="big"></div>
            <div class="bar"><i></i><b></b></div>
            <div class="line"><span class="l"></span><span class="s"></span></div>
          </div>
          <div class="btns">
            <button class="season" aria-label="Season (watering automation)"><ha-icon icon="mdi:power"></ha-icon></button>
            <button class="water" aria-label="Water now"><ha-icon icon="mdi:water"></ha-icon></button>
            <button class="stop" aria-label="Stop"><ha-icon icon="mdi:stop"></ha-icon></button>
          </div>
        </div>
        <div class="ctl">
          ${stepper("target", "mdi:water-percent", "target")}
          ${stepper("runtime", "mdi:timer-outline", "run time")}
        </div>
        <dialog tabindex="-1"></dialog>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    const step = (cls) => ({ box: $(`.step.${cls}`), dn: $(`.step.${cls} .dn`), up: $(`.step.${cls} .upb`), val: $(`.step.${cls} .v span`), unit: $(`.step.${cls} .v small`) });
    this._el = {
      card: $("ha-card"), pic: $(".pic"), wide: $(".pic .wide"), narrow: $(".pic .narrow"),
      txt: $(".txt"), name: $(".name"), big: $(".big"), bar: $(".bar"), fill: $(".bar i"), tick: $(".bar b"), line: $(".line"), lineL: $(".line .l"), lineS: $(".line .s"),
      season: $(".season"), water: $(".water"), stop: $(".stop"),
      ctl: $(".ctl"), target: step("target"), runtime: step("runtime"), dialog: $("dialog"),
    };
    this._sceneKey = null;
    const e = this._el;
    e.season.style.display = en.automation ? "" : "none";
    e.target.box.style.display = en.target ? "" : "none";
    e.runtime.box.style.display = en.run_time ? "" : "none";
    e.ctl.style.display = en.target || en.run_time ? "" : "none";

    const button = (el, fn) => {
      el.addEventListener("click", (ev) => { ev.stopPropagation(); if (!el.disabled) fn(); });
      el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    };
    button(e.season, () => this._toggleSeason());
    button(e.water, () => this._waterNow());
    button(e.stop, () => this._stopWater());
    button(e.target.dn, () => this._step("target", -1));
    button(e.target.up, () => this._step("target", 1));
    button(e.runtime.dn, () => this._step("run_time", -1));
    button(e.runtime.up, () => this._step("run_time", 1));
    this._bindPress(e.txt);
    this._bindPress(e.pic);
    e.dialog.addEventListener("click", (ev) => {
      if (ev.target === e.dialog) { this._closeDetails(); return; } // backdrop
      const close = ev.target.closest && ev.target.closest(".close");
      if (close) { this._closeDetails(); return; }
      const row = ev.target.closest && ev.target.closest(".row[data-entity]");
      if (row) {
        const id = row.getAttribute("data-entity");
        this._closeDetails();
        this._run({ action: "more-info" }, "tap", id);
      }
    });
    e.dialog.addEventListener("close", () => { this._detailsOpen = false; });
  }

  /* Tap and hold on the picture and text. */
  _bindPress(el) {
    let timer = null;
    let start = null;
    let held = false;
    const cancel = () => { clearTimeout(timer); timer = null; start = null; };
    el.addEventListener("pointerdown", (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      held = false;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => { timer = null; held = true; this._run(this._config.hold_action, "hold"); }, IR_HOLD_MS);
    });
    el.addEventListener("pointermove", (ev) => {
      if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > IR_MOVE_PX) cancel();
    });
    el.addEventListener("pointerup", () => {
      if (!start) return;
      const wasHeld = held;
      cancel();
      if (!wasHeld) this._tap();
    });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      this._tap();
    });
  }

  _tap() {
    if (this._config.tap_action) this._run(this._config.tap_action, "tap");
    else this._openDetails();
  }

  /* ---- actions ------------------------------------------------------------ */

  /* Hands an action to Home Assistant's own handler, like built-in cards do. */
  _run(conf, kind, entity) {
    if (!conf || conf.action === "none") return;
    window.dispatchEvent(new CustomEvent("haptic", { detail: kind === "hold" ? "medium" : "light" }));
    const config = { entity: entity || this._config.entities.valve };
    config[kind === "hold" ? "hold_action" : "tap_action"] = conf;
    this.dispatchEvent(new CustomEvent("hass-action", {
      bubbles: true, composed: true, detail: { config, action: kind },
    }));
  }

  _perform(service, entity, data) {
    this._run({ action: "perform-action", perform_action: service, target: { entity_id: entity }, ...(data ? { data } : {}) }, "tap");
  }

  _toggleSeason() {
    const on = this._on("automation");
    this._perform(on ? "automation.turn_off" : "automation.turn_on", this._config.entities.automation);
  }

  /* Valve on, and the timer for the run time; the automation closes the valve when the timer ends. */
  _waterNow() {
    const en = this._config.entities;
    this._perform("switch.turn_on", en.valve);
    if (en.timer) {
      const min = this._value("run_time") || 15;
      const secs = Math.round(min * 60);
      const p = (n) => String(n).padStart(2, "0");
      this._perform("timer.start", en.timer, { duration: `${p(Math.floor(secs / 3600))}:${p(Math.floor(secs / 60) % 60)}:${p(secs % 60)}` });
    }
  }

  _stopWater() {
    const en = this._config.entities;
    this._perform("switch.turn_off", en.valve);
    const t = this._s("timer");
    if (en.timer && t && ["active", "paused"].includes(irKey(t.state))) this._perform("timer.cancel", en.timer);
  }

  _limits(role) {
    const s = this._s(role);
    const a = (s && s.attributes) || {};
    const def = role === "target" ? [20, 80, 5] : [1, 30, 1];
    const min = irNum(a.min);
    const max = irNum(a.max);
    const step = irNum(a.step);
    return { min: min === null ? def[0] : min, max: max === null ? def[1] : max, step: step === null || step <= 0 ? def[2] : step };
  }

  /* Stepper value: the one just sent until HA confirms it, else the entity's. */
  _value(role) {
    const p = this._pending[role];
    const s = this._s(role);
    const v = s && !IR_BAD.includes(irKey(s.state)) ? irNum(s.state) : null;
    if (p) {
      if (this._now() < p.until && v !== p.value) return p.value;
      delete this._pending[role];
    }
    return v;
  }

  _step(role, dir) {
    const cur = this._value(role);
    if (cur === null) return;
    const { min, max, step } = this._limits(role);
    const next = Math.max(min, Math.min(max, Math.round((cur + dir * step) * 1000) / 1000));
    if (next === cur) return;
    this._pending[role] = { value: next, until: this._now() + IR_PENDING_MS };
    this._perform("input_number.set_value", this._config.entities[role], { value: next });
    this._update();
  }

  /* ---- state -------------------------------------------------------------- */

  _s(role) {
    const id = this._config.entities[role];
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _ok(role) {
    const s = this._s(role);
    return !!s && !IR_BAD.includes(irKey(s.state));
  }

  _on(role) {
    const s = this._s(role);
    return !!s && ["on", "open", "true"].includes(irKey(s.state));
  }

  _n(role) {
    return this._ok(role) ? irNum(this._s(role).state) : null;
  }

  /* A moment from a timestamp sensor (Unix seconds or ms, or ISO) or an input_datetime. */
  _ms(role) {
    const s = this._s(role);
    if (!s) return null;
    const ts = irNum(s.attributes && s.attributes.timestamp);
    if (role === "last_started" && ts) return ts * 1000;
    if (IR_BAD.includes(irKey(s.state))) return null;
    const n = irNum(s.state);
    if (n !== null) return n <= 0 ? null : n > 1e12 ? n : n * 1000;
    const t = Date.parse(String(s.state).replace(" ", "T"));
    return isNaN(t) ? null : t;
  }

  _lang() {
    const h = this._hass;
    return (h && h.locale && h.locale.language) || (h && h.language) || "en";
  }

  _fmt(ms, opts) {
    const tz = this._hass && this._hass.config && this._hass.config.time_zone;
    const o = { hour12: false, ...opts };
    try {
      return new Intl.DateTimeFormat(this._lang(), tz ? { ...o, timeZone: tz } : o).format(new Date(ms));
    } catch (_) {
      return new Intl.DateTimeFormat("en-GB", o).format(new Date(ms));
    }
  }

  _clock(ms) {
    return this._fmt(ms, { hour: "2-digit", minute: "2-digit" });
  }

  _when(ms) {
    return this._fmt(ms, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  /* Minutes since local midnight in HA's time zone. */
  _minuteOfDay(ms) {
    const tz = this._hass && this._hass.config && this._hass.config.time_zone;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(ms));
      const get = (t) => Number(parts.find((p) => p.type === t).value);
      return get("hour") * 60 + get("minute");
    } catch (_) {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  _inWindow(ms) {
    const m = this._minuteOfDay(ms);
    const toMin = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
    const a = toMin(this._config.start);
    const b = toMin(this._config.end);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }

  /* "03–06", or "03:30–06" when not on the hour. */
  _windowText() {
    const short = (t) => (t.endsWith(":00") ? t.slice(0, 2) : t);
    return `${short(this._config.start)}–${short(this._config.end)}`;
  }

  _ago(ms, now) {
    const min = Math.max(0, Math.round((now - ms) / 60000));
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    if (d === 1) return "yesterday";
    if (d < 14) return `${d} days ago`;
    if (d < 60) return `${Math.round(d / 7)} weeks ago`;
    return `${Math.round(d / 30)} months ago`;
  }

  _countdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  _soilSeen() {
    let seen = null;
    for (const role of IR_SOIL_ROLES) {
      const s = this._s(role);
      if (!s || IR_BAD.includes(irKey(s.state))) continue;
      const t = Math.max(...[s.last_reported, s.last_updated, s.last_changed].map((v) => Date.parse(v)).filter((v) => !isNaN(v)));
      if (isFinite(t) && (seen === null || t > seen)) seen = t;
    }
    return seen;
  }

  /* Everything the card shows, worked out from the entities. */
  _state(now) {
    const en = this._config.entities;
    const valveBad = !this._ok("valve");
    const valveOn = this._on("valve");
    const open = !valveBad && (en.valve_open && this._ok("valve_open") ? this._on("valve_open") : valveOn);
    const watering = !valveBad && (valveOn || open);

    const t = this._s("timer");
    const ts = t ? irKey(t.state) : "";
    const parseDur = (v) => {
      const p = String(v || "").split(":").map(Number);
      return p.length === 3 && p.every((x) => !isNaN(x)) ? ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000 : null;
    };
    let remaining = null;
    if (ts === "active") {
      const fin = Date.parse(t.attributes && t.attributes.finishes_at);
      remaining = !isNaN(fin) ? Math.max(0, fin - now) : parseDur(t.attributes && t.attributes.remaining);
    } else if (ts === "paused") {
      remaining = parseDur(t.attributes && t.attributes.remaining);
    }
    const timerRunning = ts === "active" || ts === "paused";

    // The valve keeps reporting water_shortage until its next run. Only warn when it matters:
    // while watering (or the timer runs) or while the season is on; out of season it is old news.
    const shortageRaw = irKey(this._s("valve_status") && this._s("valve_status").state) === "water_shortage";
    const moisture = en.moisture ? this._n("moisture") : null;
    const target = en.target ? this._value("target") : null;
    const runTime = en.run_time ? this._value("run_time") : null;
    const seasonKnown = !!en.automation && this._ok("automation");
    const season = seasonKnown ? this._on("automation") : null;
    const shortage = shortageRaw && (watering || timerRunning || season !== false);

    const soilSeen = this._soilSeen();
    const soilGone = !!en.moisture && !this._ok("moisture");
    const stale = soilGone || (soilSeen !== null && now - soilSeen > this._config.staleMs);
    const low = this._config.lowBattery;
    const valveBat = en.valve_battery ? this._n("valve_battery") : null;
    const soilBat = en.soil_battery ? this._n("soil_battery") : null;

    const start = en.run_start ? this._ms("run_start") : null;
    const ls = en.last_started ? this._ms("last_started") : null;
    const lastStart = Math.max(start || 0, ls || 0) || null;
    let lastEnd = en.run_end ? this._ms("run_end") : null;
    if (lastEnd !== null && start !== null && lastEnd < start) lastEnd = null; // still running, or no end yet
    const runVolume = en.run_volume ? this._n("run_volume") : null;

    const sun = this._s("sun");
    const night = !!sun && irKey(sun.state) === "below_horizon";

    const warnings = [];
    if (valveBad) warnings.push("Valve unavailable");
    if (shortage) warnings.push("Water shortage");
    if (soilGone) warnings.push("Soil sensor unavailable");
    else if (stale) warnings.push(`Soil sensor silent ${Math.floor((now - soilSeen) / 3600000)} h`);
    if (valveBat !== null && valveBat < low) warnings.push(`Valve battery ${Math.round(valveBat)} %`);
    if (soilBat !== null && soilBat < low) warnings.push(`Sensor battery ${Math.round(soilBat)} %`);

    const canWater = !valveBad && !watering && !timerRunning && (this._config.waterNow === "always" || season !== false);

    return {
      valveBad, valveOn, open, watering, timerRunning, paused: ts === "paused", remaining,
      shortage, shortageRaw, moisture, target, runTime, season, seasonKnown, stale, soilGone, soilSeen,
      valveLow: valveBat !== null && valveBat < low, soilLow: soilBat !== null && soilBat < low,
      lastStart, lastEnd, runVolume, night, warnings, canWater,
      inWindow: this._inWindow(now),
    };
  }

  _texts(st, now) {
    let big;
    let unit = "";
    let word = false;
    if (st.watering || st.timerRunning) {
      if (st.remaining !== null) { big = this._countdown(st.remaining); unit = st.paused ? "paused" : "left"; }
      else { big = "Watering"; word = true; }
    } else if (st.moisture !== null) {
      big = `${Math.round(st.moisture)}`;
      unit = "% soil";
    } else {
      big = st.valveBad ? "Unavailable" : "Idle";
      word = true;
    }

    let line = "";
    let short = null; // shorter form for a narrow text column
    const pct = st.moisture !== null ? `Soil ${Math.round(st.moisture)} %` : null;
    const win = this._windowText();
    if (st.valveBad) {
      line = pct || "";
    } else if (st.watering || st.timerRunning) {
      if (!st.open) line = st.timerRunning ? "Valve closed" : "Valve opening";
      else {
        const parts = [];
        if (pct) parts.push(pct);
        if (st.runVolume !== null) parts.push(`${Math.round(st.runVolume)} L so far`);
        line = parts.join(" · ") || "Watering";
      }
    } else if (st.season === false) {
      line = st.lastStart ? `Season off · last ${this._ago(st.lastStart, now)}` : "Season off";
      if (st.lastStart) short = `Season off · ${this._ago(st.lastStart, now)}`;
    } else {
      const lastAt = st.lastEnd || st.lastStart;
      if (lastAt && now - lastAt < IR_RECENT_MS && now >= lastAt) {
        const vol = st.lastEnd && st.runVolume !== null ? ` · ${Math.round(st.runVolume)} L` : "";
        line = `Watered ${this._clock(st.lastStart || lastAt)}${vol}`;
      } else if (st.moisture !== null && st.target !== null) {
        if (st.moisture < st.target) line = st.inWindow && st.season ? "Waters within 15 min" : `Waters tonight ${win}`;
        else { line = `Tonight ${win} if below ${st.target} %`; short = `Tonight if below ${st.target} %`; }
      } else {
        line = st.season ? `Waters tonight ${win} when dry` : "";
        short = st.season ? `Waters tonight ${win}` : null;
      }
    }
    return { big, unit, word, line, short: short || line };
  }

  _update() {
    if (!this._hass || !this._el) return;
    const e = this._el;
    const now = this._now();
    const st = this._state(now);

    // count down every second while watering
    const fast = st.watering || st.timerRunning;
    if (fast && !this._fast) this._fast = setInterval(() => this._update(), IR_FAST_MS);
    if (!fast && this._fast) { clearInterval(this._fast); this._fast = null; }

    // Picture: only redrawn when something in it changes.
    const scene = {
      moist: st.moisture === null ? null : Math.round(st.moisture),
      dry: st.moisture !== null && st.target !== null && st.moisture < st.target,
      open: st.open, night: st.night, shortage: st.shortage, valveLow: st.valveLow,
      soilLow: st.soilLow, stale: st.stale, off: st.season === false,
    };
    const key = JSON.stringify(scene);
    if (key !== this._sceneKey) {
      this._sceneKey = key;
      e.wide.innerHTML = irScene({ ...scene, w: 191 });
      e.narrow.innerHTML = irScene({ ...scene, w: 128 });
    }
    e.card.classList.toggle("off", st.season === false);
    e.card.classList.toggle("watering", st.open);
    e.card.classList.toggle("unavailable", st.valveBad);

    // Name row: the first warning (+ how many more), else the name.
    const w = st.warnings;
    e.name.textContent = w.length ? `${w[0]}${w.length > 1 ? ` · +${w.length - 1}` : ""}` : this._config.name;
    e.name.classList.toggle("warn", w.length > 0);

    const tx = this._texts(st, now);
    const bigKey = `${tx.word}|${tx.big}|${tx.unit}`;
    if (e.big._shown !== bigKey) {
      e.big._shown = bigKey;
      e.big.classList.toggle("word", tx.word);
      e.big.textContent = tx.big;
      if (tx.unit) { const sm = document.createElement("small"); sm.textContent = tx.unit; e.big.appendChild(sm); }
    }
    e.lineL.textContent = tx.line;
    e.lineS.textContent = tx.short;

    // Moisture bar with the target marked.
    e.bar.style.display = st.moisture === null ? "none" : "";
    e.fill.style.width = `${Math.max(0, Math.min(100, st.moisture || 0))}%`;
    e.tick.style.display = st.target === null ? "none" : "";
    e.tick.style.left = `${Math.max(0, Math.min(100, st.target || 0))}%`;

    // Buttons: only what applies now.
    e.season.disabled = !st.seasonKnown;
    e.season.classList.toggle("on", st.season === true);
    e.season.title = st.season ? "Season on: turn the watering automation off" : "Season off: turn the watering automation on";
    e.water.disabled = !st.canWater;
    e.water.classList.toggle("run", st.open);
    e.water.title = !st.valveBad && !st.watering && st.season === false && this._config.waterNow === "season"
      ? "Season off: the automation that closes the valve after the run time is off" : "Water now";
    e.stop.disabled = st.valveBad ? !st.timerRunning : !(st.watering || st.timerRunning);

    // Steppers
    const stepper = (box, role, val, unit) => {
      const l = this._limits(role);
      box.val.textContent = val === null ? "–" : irF(val);
      box.unit.textContent = unit;
      box.dn.disabled = val === null || val <= l.min;
      box.up.disabled = val === null || val >= l.max;
    };
    stepper(e.target, "target", st.target, "% target");
    stepper(e.runtime, "run_time", st.runTime, "min run");

    e.pic.setAttribute("aria-label", `${this._config.name}: ${tx.big} ${tx.unit}, ${tx.line}`);
    if (this._detailsOpen) this._fillDetails(st, now);
  }

  /* ---- details pop-up ----------------------------------------------------- */

  _openDetails() {
    const d = this._el.dialog;
    this._detailsOpen = true;
    this._fillDetails(this._state(this._now()), this._now());
    if (typeof d.showModal === "function") { try { d.showModal(); } catch (_) { d.setAttribute("open", ""); } }
    else d.setAttribute("open", "");
    try { d.focus(); } catch (_) { /* no focus in this browser */ } // not the close button: no focus ring on open
  }

  _closeDetails() {
    const d = this._el.dialog;
    this._detailsOpen = false;
    if (typeof d.close === "function") { try { d.close(); } catch (_) { /* not open */ } }
    d.removeAttribute("open");
  }

  /* Value of an entity with its unit, rounded sensibly. */
  _val(role) {
    const s = this._s(role);
    if (!s) return "–";
    if (IR_BAD.includes(irKey(s.state))) return irKey(s.state) || "–";
    const n = irNum(s.state);
    const unit = (s.attributes && s.attributes.unit_of_measurement) || "";
    if (n === null) return String(s.state).replace(/_/g, " ");
    const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
    return `${r.toLocaleString(this._lang())}${unit ? ` ${unit}` : ""}`;
  }

  _fillDetails(st, now) {
    const en = this._config.entities;
    const rows = [];
    const row = (label, role, value, warn) => {
      if (role && !en[role]) return;
      rows.push(`<div class="row${warn ? " warn" : ""}"${role ? ` data-entity="${irEsc(en[role])}"` : ""}><span>${irEsc(label)}</span><span>${irEsc(value)}</span></div>`);
    };
    const section = (title) => rows.push(`<h3>${irEsc(title)}</h3>`);
    const onOff = (role, on, off) => (this._ok(role) ? (this._on(role) ? on : off) : this._val(role));

    section("Soil");
    row("Moisture", "moisture", this._val("moisture"));
    row("Fertility (conductivity)", "conductivity", this._val("conductivity"));
    row("Soil temperature", "soil_temperature", this._val("soil_temperature"));
    row("Light", "illuminance", this._val("illuminance"));
    row("Sensor battery", "soil_battery", this._val("soil_battery"), st.soilLow);
    if (en.moisture) row("Last heard", null, st.soilSeen ? this._ago(st.soilSeen, now) : "–", st.stale);

    section("Valve");
    row("Valve", "valve", st.valveBad ? this._val("valve") : st.open ? "Open" : st.valveOn ? "On, closed" : "Closed");
    row("Status", "valve_status", this._val("valve_status"), st.shortageRaw);
    row("Flow", "flow", this._val("flow"));
    row("Used today", "daily_volume", this._val("daily_volume"));
    row("Valve battery", "valve_battery", this._val("valve_battery"), st.valveLow);
    row("Closes on water shortage", "auto_close", onOff("auto_close", "Yes", "No"));

    section("Last run");
    const start = en.run_start ? this._ms("run_start") : null;
    const end = en.run_end ? this._ms("run_end") : null;
    row("Started", "run_start", start ? this._when(start) : "–");
    row("Ended", "run_end", end && (!start || end >= start) ? this._when(end) : st.open ? "running" : "–");
    const dur = en.run_duration ? this._n("run_duration") : null;
    row("Duration", "run_duration", dur === null ? this._val("run_duration") : (Math.round(dur % 60) ? `${Math.floor(dur / 60)} min ${Math.round(dur % 60)} s` : `${Math.floor(dur / 60)} min`));
    row("Volume", "run_volume", this._val("run_volume"));
    const ls = en.last_started ? this._ms("last_started") : null;
    row("Last automatic start", "last_started", ls ? `${this._when(ls)} (${this._ago(ls, now)})` : "–");

    section("Watering");
    row("Season (automation)", "automation", onOff("automation", "On", "Off"));
    row("Watering window", null, `${this._config.start}–${this._config.end}`);
    row("Target", "target", st.target === null ? "–" : `below ${irF(st.target)} %`);
    row("Run time", "run_time", st.runTime === null ? "–" : `${irF(st.runTime)} min`);
    if (en.timer) row("Timer", "timer", st.remaining !== null ? `${this._countdown(st.remaining)} ${st.paused ? "paused" : "left"}` : this._val("timer"));

    const note = this._config.waterNow === "season" && st.season === false
      ? `<div class="note">Water now is off while the season is off: the watering automation closes the valve when the timer ends.</div>` : "";
    const html = `
      <div class="dh"><div class="t">${irEsc(this._config.name)}</div><button class="close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="ds">${rows.join("")}</div>${note}`;
    if (this._el.dialog._html !== html) {
      this._el.dialog._html = html;
      this._el.dialog.innerHTML = html;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Visual editor                                                            */
/* ------------------------------------------------------------------------ */

/*
 * Built on HA's own <ha-form>. Every field shows the value in use, defaults
 * included; only values that differ from the defaults are written to the
 * YAML. Clearing an optional entity switches that part off (null); clearing
 * the valve or a number goes back to its default. Options the editor does not
 * show (grid_options, ...) are kept.
 */

const IR_ENTITY_FIELDS = [
  ["valve", "Valve switch (required)", ["switch"]],
  ["valve_open", "Valve open (work state)", ["binary_sensor"]],
  ["valve_status", "Valve status (water_shortage)", ["sensor"]],
  ["auto_close", "Close on water shortage", ["switch"]],
  ["flow", "Flow", ["sensor"]],
  ["run_duration", "Run duration (s)", ["sensor"]],
  ["run_volume", "Run volume (L)", ["sensor"]],
  ["daily_volume", "Daily volume (L)", ["sensor"]],
  ["run_start", "Run start time", ["sensor"]],
  ["run_end", "Run end time", ["sensor"]],
  ["valve_battery", "Valve battery", ["sensor"]],
  ["moisture", "Soil moisture", ["sensor"]],
  ["conductivity", "Soil conductivity", ["sensor"]],
  ["soil_temperature", "Soil temperature", ["sensor"]],
  ["illuminance", "Light at the plants", ["sensor"]],
  ["soil_battery", "Soil sensor battery", ["sensor"]],
  ["target", "Moisture target (input_number)", ["input_number", "number"]],
  ["run_time", "Run time, minutes (input_number)", ["input_number", "number"]],
  ["timer", "Watering timer", ["timer"]],
  ["last_started", "Last start (input_datetime)", ["input_datetime"]],
  ["automation", "Watering automation (season)", ["automation"]],
  ["sun", "Sun (moon at night)", ["sun"]],
];
const IR_REQUIRED = ["valve"];

const IR_NUMBER_FIELDS = [
  ["low_battery", "Low battery below", 0, 100, "%"],
  ["stale_after", "Soil sensor silent after", 1, 168, "h"],
];
const IR_TIME_FIELDS = ["window_start", "window_end"];

const IR_EDITOR_SCHEMA = [
  { name: "name", selector: { text: {} } },
  {
    type: "expandable",
    name: "entities",
    title: "Entities",
    icon: "mdi:sprinkler-variant",
    expanded: true,
    schema: IR_ENTITY_FIELDS.map(([role, , domains]) => ({
      name: role,
      selector: { entity: { filter: { domain: domains } } },
    })),
  },
  {
    type: "expandable",
    name: "",
    title: "Watering and warnings",
    icon: "mdi:clock-outline",
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          ...IR_TIME_FIELDS.map((k) => ({ name: k, selector: { time: {} } })),
          ...IR_NUMBER_FIELDS.map(([k, , min, max, unit]) => ({
            name: k,
            selector: { number: { min, max, step: 1, mode: "box", unit_of_measurement: unit } },
          })),
        ],
      },
      {
        name: "water_now",
        selector: { select: { mode: "dropdown", options: [
          { value: "season", label: "Only while the season is on" },
          { value: "always", label: "Always (something else closes the valve)" },
        ] } },
      },
    ],
  },
  {
    type: "expandable",
    name: "",
    title: "Actions",
    icon: "mdi:gesture-tap",
    schema: [
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "hold_action", selector: { ui_action: { default_action: "more-info" } } },
    ],
  },
  {
    type: "expandable",
    name: "colors",
    title: "Colours",
    icon: "mdi:palette",
    schema: [{
      type: "grid",
      name: "",
      schema: Object.keys(IR_COLORS).map((k) => ({ name: k, selector: { text: {} } })),
    }],
  },
];

const IR_EDITOR_LABELS = {
  name: "Name",
  window_start: "Automation waters from",
  window_end: "until",
  water_now: "Water now",
  tap_action: "Tap action (empty: details pop-up)",
  hold_action: "Hold action",
  water: "water (bar, watering)",
  on: "season on",
  warn: "warnings",
  ...Object.fromEntries(IR_ENTITY_FIELDS.map(([k, label]) => [k, label])),
  ...Object.fromEntries(IR_NUMBER_FIELDS.map(([k, label]) => [k, label])),
};

const IR_ACTION_KEYS = ["tap_action", "hold_action"];

class IrrigationCardEditor extends HTMLElement {
  /* config -> form data: defaults filled in, null shown as empty. */
  static toData(config) {
    const ent = config.entities || {};
    const entities = {};
    for (const role of Object.keys(IR_DEFAULTS.entities)) {
      const v = role in ent ? ent[role] : IR_DEFAULTS.entities[role];
      entities[role] = v || "";
    }
    const data = {
      name: config.name == null ? IR_DEFAULTS.name : config.name,
      entities,
      water_now: config.water_now == null ? IR_DEFAULTS.water_now : config.water_now,
      colors: { ...(config.colors || {}) },
    };
    for (const k of IR_ACTION_KEYS) data[k] = config[k];
    for (const [k] of IR_NUMBER_FIELDS) {
      const v = irNum(config[k]);
      data[k] = v == null ? IR_DEFAULTS[k] : v;
    }
    for (const k of IR_TIME_FIELDS) data[k] = irTime(config[k]) ? `${irHM(config[k])}:00` : `${IR_DEFAULTS[k]}:00`;
    return data;
  }

  /* form data -> config: only what differs from the defaults. */
  static toConfig(data, previous) {
    const config = { type: "custom:irrigation-card" };
    const handled = ["type", "name", "entities", "colors", "water_now", ...IR_ACTION_KEYS, ...IR_TIME_FIELDS, ...IR_NUMBER_FIELDS.map(([k]) => k)];
    for (const [k, v] of Object.entries(previous || {})) {
      if (!handled.includes(k)) config[k] = v;
    }
    if (data.name != null && data.name !== IR_DEFAULTS.name) config.name = data.name;
    const entities = {};
    for (const [role, def] of Object.entries(IR_DEFAULTS.entities)) {
      const v = (data.entities || {})[role];
      if (!v) {
        if (def && !IR_REQUIRED.includes(role)) entities[role] = null;
      } else if (v !== def) entities[role] = v;
    }
    if (Object.keys(entities).length) config.entities = entities;
    for (const k of IR_TIME_FIELDS) {
      if (irTime(data[k]) && irHM(data[k]) !== IR_DEFAULTS[k]) config[k] = irHM(data[k]);
    }
    for (const [k] of IR_NUMBER_FIELDS) {
      const v = irNum(data[k]);
      if (v != null && v !== IR_DEFAULTS[k]) config[k] = v;
    }
    if (data.water_now && data.water_now !== IR_DEFAULTS.water_now) config.water_now = data.water_now;
    for (const k of IR_ACTION_KEYS) if (data[k] && Object.keys(data[k]).length) config[k] = data[k];
    const colors = {};
    for (const [k, v] of Object.entries(data.colors || {})) {
      if (typeof v === "string" && v.trim()) colors[k] = v.trim();
    }
    if (Object.keys(colors).length) config.colors = colors;
    return config;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._loadForm().then(() => this._render());
  }

  /* ha-form is lazy loaded by HA; load it through a built-in card's editor. */
  async _loadForm() {
    if (customElements.get("ha-form")) return;
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "entities", entities: [] });
      if (card.constructor.getConfigElement) await card.constructor.getConfigElement();
    } catch (_) {
      /* rendered as soon as HA has loaded it */
    }
    await customElements.whenDefined("ha-form");
  }

  _render() {
    if (!this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = IR_EDITOR_SCHEMA;
      this._form.computeLabel = (s) => IR_EDITOR_LABELS[s.name] || s.name.replace(/_/g, " ");
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const config = IrrigationCardEditor.toConfig(e.detail.value, this._config);
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = IrrigationCardEditor.toData(this._config);
  }
}

if (!customElements.get("irrigation-card")) {
  customElements.define("irrigation-card", IrrigationCard);
}
if (!customElements.get("irrigation-card-editor")) {
  customElements.define("irrigation-card-editor", IrrigationCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "irrigation-card")) {
  window.customCards.push({
    type: "irrigation-card",
    name: "Irrigation Card",
    description: "Garden watering valve with a soil sensor: moisture against the target, status, warnings, season, Water now and Stop, target and run time.",
    preview: true,
    documentationURL: "https://github.com/BarBaar44/irrigation-card",
  });
}

console.info(`%c IRRIGATION-CARD %c ${VERSION} `, "background:#2e7d32;color:#fff", "");
}
