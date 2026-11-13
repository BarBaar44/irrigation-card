// Tests for irrigation-card.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const src = fs.readFileSync(path.join(__dirname, "..", "irrigation-card.js"), "utf8");
w.eval(src);
w.eval(src); // loading twice as a classic script must not throw (no top-level name clashes)
const Card = w.customElements.get("irrigation-card");
const Editor = w.customElements.get("irrigation-card-editor");
assert(Card && Editor, "registered");

const MIN = 60000;
const H = 60 * MIN;
const NOW = Date.parse("2026-07-01T14:00:00Z"); // 14:00 UTC, outside the 03:00 to 06:00 window
const iso = (ms) => new Date(ms).toISOString();
const st = (state, attributes = {}, seen = NOW) => ({ state: String(state), attributes, last_changed: iso(seen), last_updated: iso(seen) });

/* Bb's entities with sensible values; o overrides parts. */
const states = (o = {}) => {
  const soilSeen = o.soilSeen ?? NOW - 10 * MIN;
  const s = {
    "switch.watervalve_balcony": st(o.valve ?? "off"),
    "binary_sensor.watervalve_balcony_valve_work_state": st(o.open ?? "off"),
    "sensor.watervalve_balcony_current_device_status": st(o.status ?? "normal"),
    "switch.watervalve_balcony_auto_close_when_water_shortage": st("on"),
    "sensor.watervalve_balcony_flow": st(o.flow ?? 0, { unit_of_measurement: "m³/h" }),
    "sensor.watervalve_balcony_real_time_irrigation_duration": st(o.dur ?? 905, { unit_of_measurement: "s" }),
    "sensor.watervalve_balcony_real_time_irrigation_volume": st(o.vol ?? 42, { unit_of_measurement: "L" }),
    "sensor.watervalve_balcony_daily_irrigation_volume": st(o.daily ?? 0, { unit_of_measurement: "L" }),
    "sensor.watervalve_balcony_irrigation_start_time": st(o.start === undefined ? Math.round((NOW - 60 * 24 * H) / 1000) : o.start),
    "sensor.watervalve_balcony_irrigation_end_time": st(o.end === undefined ? Math.round((NOW - 60 * 24 * H + 15 * MIN) / 1000) : o.end),
    "sensor.watervalve_balcony_battery": st(o.vbat ?? 80, { unit_of_measurement: "%" }),
    "sensor.soil_sensor_vegtable_garden_1_moisture": st(o.moist ?? 34, { unit_of_measurement: "%" }, soilSeen),
    "sensor.soil_sensor_vegtable_garden_1_conductivity": st(310, { unit_of_measurement: "µS/cm" }, soilSeen),
    "sensor.soil_sensor_vegtable_garden_1_temperature": st(16.4, { unit_of_measurement: "°C" }, soilSeen),
    "sensor.soil_sensor_vegtable_garden_1_illuminance": st(5400, { unit_of_measurement: "lx" }, soilSeen),
    "sensor.soil_sensor_vegtable_garden_1_battery": st(o.sbat ?? 60, { unit_of_measurement: "%" }, soilSeen),
    "input_number.soil_balcony_value": st(o.target ?? 40, { min: 20, max: 80, step: 5 }),
    "input_number.watervalve_balcony_timer_value": st(o.run ?? 15, { min: 1, max: 30, step: 1 }),
    "timer.watervalve_balcony": st(o.timer ?? "idle", o.timerAttrs || { duration: "0:15:00" }),
    "input_datetime.balconyvalvelaststarted": st("2026-05-02 03:15:00", { has_date: true, has_time: true, timestamp: (NOW - 60 * 24 * H) / 1000 }),
    "automation.balcony_valve": st(o.season ?? "on"),
    "sun.sun": st(o.sun || "above_horizon"),
  };
  return { ...s, ...(o.extra || {}) };
};
const hass = (s) => ({ states: s, language: "en", locale: { language: "en" }, config: { time_zone: "UTC" } });

function render(s, config = {}, now = NOW) {
  const c = new Card();
  c._now = () => now;
  w.document.body.appendChild(c);
  c.setConfig(config);
  c.hass = hass(s);
  return c;
}
function read(c) {
  const e = c._el;
  return {
    name: e.name.textContent,
    warn: e.name.classList.contains("warn"),
    big: e.big.textContent,
    line: e.lineL.textContent, short: e.lineS.textContent,
    season: !e.season.disabled, seasonOn: e.season.classList.contains("on"),
    water: !e.water.disabled, stop: !e.stop.disabled,
    target: e.target.val.textContent, run: e.runtime.val.textContent,
    tDn: !e.target.dn.disabled, tUp: !e.target.up.disabled,
    rDn: !e.runtime.dn.disabled, rUp: !e.runtime.up.disabled,
    bar: e.fill.style.width, tick: e.tick.style.left,
    scene: e.wide.innerHTML, narrow: e.narrow.innerHTML,
    off: e.card.classList.contains("off"),
  };
}
function actions(c) {
  const got = [];
  c.addEventListener("hass-action", (ev) => got.push(JSON.parse(JSON.stringify(ev.detail))));
  return got;
}
const perf = (a) => a.map((x) => x.config.tap_action).filter((t) => t.action === "perform-action")
  .map((t) => [t.perform_action, t.target.entity_id, t.data || null]);
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("empty config works with the owner's entities; grid 12 x 3", () => {
  const c = render(states());
  const r = read(c);
  assert.strictEqual(r.name, "Garden irrigation");
  assert.strictEqual(r.big, "34% soil");
  same(c.getGridOptions(), { columns: 12, rows: 3, min_columns: 6, min_rows: 3 });
  assert.strictEqual(c.getCardSize(), 3);
});

test("bar: moisture fill and target tick", () => {
  const r = read(render(states({ moist: 34, target: 40 })));
  assert.strictEqual(r.bar, "34%");
  assert.strictEqual(r.tick, "40%");
});

test("season off: line with last run, picture faded, Water now off, Stop off", () => {
  const r = read(render(states({ season: "off" })));
  assert.strictEqual(r.line, "Season off · last 2 months ago");
  assert.strictEqual(r.short, "Season off · 2 months ago");
  assert(r.off);
  assert(r.season && !r.seasonOn);
  assert(!r.water, "Water now needs the automation to close the valve");
  assert(!r.stop);
});

test("season off with water_now: always: Water now on", () => {
  assert(read(render(states({ season: "off" }), { water_now: "always" })).water);
});

test("season on, moist enough: tonight if below target", () => {
  const r = read(render(states({ moist: 52 })));
  assert.strictEqual(r.line, "Tonight 03–06 if below 40 %");
  assert.strictEqual(r.short, "Tonight if below 40 %");
  assert(r.seasonOn && r.water && !r.stop);
  assert(!/a5b55a/.test(r.scene), "plants green above the target");
});

test("season on, below target: waters tonight; inside the window: within 15 min", () => {
  let r = read(render(states({ moist: 31 })));
  assert.strictEqual(r.line, "Waters tonight 03–06");
  assert(/a5b55a/.test(r.scene), "plants a little yellow below the target");
  r = read(render(states({ moist: 31 }), {}, Date.parse("2026-07-01T04:10:00Z")));
  assert.strictEqual(r.line, "Waters within 15 min");
});

test("window option changes the text (and wraps past midnight)", () => {
  const r = read(render(states({ moist: 52 }), { window_start: "22:30", window_end: "2:00" }));
  assert.strictEqual(r.line, "Tonight 22:30–02 if below 40 %");
  const c = render(states({ moist: 20 }), { window_start: "22:30", window_end: "02:00" }, Date.parse("2026-07-01T23:00:00Z"));
  assert.strictEqual(read(c).line, "Waters within 15 min");
});

test("watered recently: time and volume", () => {
  const start = Math.round((NOW - 10 * H) / 1000);
  const r = read(render(states({ moist: 46, start, end: start + 900, vol: 42.4 })));
  assert.strictEqual(r.line, "Watered 04:00 · 42 L");
});

test("watering with the timer: countdown, volume so far, Stop on, Water now off, flow drawn", () => {
  const c = render(states({ valve: "on", open: "on", vol: 18, start: Math.round((NOW - 9 * MIN) / 1000), end: Math.round((NOW - 60 * 24 * H) / 1000),
    timer: "active", timerAttrs: { duration: "0:15:00", finishes_at: iso(NOW + 6 * MIN + 12000), remaining: "0:15:00" } }));
  const r = read(c);
  assert.strictEqual(r.big, "6:12left");
  assert.strictEqual(r.line, "Soil 34 % · 18 L so far");
  assert(r.stop && !r.water);
  assert(/class="flow"/.test(r.scene) && /class="drop d0"/.test(r.scene));
  assert(c._fast, "ticks every second while watering");
  c.remove();
  assert(!c._fast);
});

test("valve on without the timer: Watering; paused timer shows paused", () => {
  assert.strictEqual(read(render(states({ valve: "on", open: "on", timer: "idle" }))).big, "Watering");
  const r = read(render(states({ valve: "on", open: "on", timer: "paused", timerAttrs: { remaining: "0:04:05" } })));
  assert.strictEqual(r.big, "4:05paused");
});

test("timer running but valve closed (shortage closed it): Stop still on", () => {
  const r = read(render(states({ status: "water_shortage", timer: "active", timerAttrs: { finishes_at: iso(NOW + 5 * MIN) } })));
  assert.strictEqual(r.line, "Valve closed");
  assert(r.stop);
  assert(r.warn && r.name.startsWith("Water shortage"));
});

test("warnings: shortage, batteries, stale; first one plus a count in the name row", () => {
  let r = read(render(states({ status: "water_shortage", sbat: 7 })));
  assert.strictEqual(r.name, "Water shortage · +1");
  assert(r.warn);
  assert(/class="alert"/.test(r.scene) && /f44336/.test(r.scene));
  r = read(render(states({ sbat: 7 })));
  assert.strictEqual(r.name, "Sensor battery 7 %");
  r = read(render(states({ vbat: 10 })));
  assert.strictEqual(r.name, "Valve battery 10 %");
  r = read(render(states({ soilSeen: NOW - 7 * H - 5 * MIN })));
  assert.strictEqual(r.name, "Soil sensor silent 7 h");
  r = read(render(states({ sbat: 15 })));
  assert(!r.warn, "15 % is not below 15 %");
  r = read(render(states({ sbat: 20 }), { low_battery: 25 }));
  assert.strictEqual(r.name, "Sensor battery 20 %");
});

test("last_reported counts for staleness (values that do not change)", () => {
  const s = states({ soilSeen: NOW - 10 * H });
  s["sensor.soil_sensor_vegtable_garden_1_moisture"].last_reported = iso(NOW - 5 * MIN);
  assert(!read(render(s)).warn);
});

test("soil sensor unavailable: warning, no bar, no moisture", () => {
  const s = states();
  s["sensor.soil_sensor_vegtable_garden_1_moisture"] = st("unavailable");
  const c = render(s);
  const r = read(c);
  assert.strictEqual(r.name, "Soil sensor unavailable");
  assert.strictEqual(r.big, "Idle");
  assert.strictEqual(c._el.bar.style.display, "none");
});

test("valve unavailable: all off but the season, warning", () => {
  const r = read(render(states({ valve: "unavailable" })));
  assert.strictEqual(r.name, "Valve unavailable");
  assert(!r.water && !r.stop && r.season);
});

test("night: moon in the picture", () => {
  assert(/class="moon"/.test(read(render(states({ sun: "below_horizon" }))).scene));
  assert(!/class="moon"/.test(read(render(states())).scene));
});

test("soil darkens with moisture; narrow picture has two plants", () => {
  const dry = read(render(states({ moist: 10 })));
  const wet = read(render(states({ moist: 70 })));
  const soil = (r) => /class="soil"[^>]*fill="([^"]+)"/.exec(r.scene)[1];
  assert.notStrictEqual(soil(dry), soil(wet));
  assert(/viewBox="0 0 128 112"/.test(dry.narrow) && /viewBox="0 0 191 112"/.test(dry.scene));
});

test("Water now: valve on and the timer for the run time", () => {
  const c = render(states({ run: 15 }));
  const got = actions(c);
  c._el.water.click();
  same(perf(got), [
    ["switch.turn_on", "switch.watervalve_balcony", null],
    ["timer.start", "timer.watervalve_balcony", { duration: "00:15:00" }],
  ]);
});

test("Stop: valve off and the timer cancelled (only when it runs)", () => {
  let c = render(states({ valve: "on", open: "on", timer: "active", timerAttrs: { finishes_at: iso(NOW + MIN) } }));
  let got = actions(c);
  c._el.stop.click();
  same(perf(got), [["switch.turn_off", "switch.watervalve_balcony", null], ["timer.cancel", "timer.watervalve_balcony", null]]);
  c = render(states({ valve: "on", open: "on" }));
  got = actions(c);
  c._el.stop.click();
  same(perf(got), [["switch.turn_off", "switch.watervalve_balcony", null]]);
});

test("disabled buttons send nothing", () => {
  const c = render(states({ season: "off" }));
  const got = actions(c);
  c._el.water.click();
  c._el.stop.click();
  assert.strictEqual(got.length, 0);
});

test("season button toggles the automation", () => {
  let c = render(states({ season: "on" }));
  let got = actions(c);
  c._el.season.click();
  same(perf(got), [["automation.turn_off", "automation.balcony_valve", null]]);
  c = render(states({ season: "off" }));
  got = actions(c);
  c._el.season.click();
  same(perf(got), [["automation.turn_on", "automation.balcony_valve", null]]);
});

test("steppers: step from the helper, shown at once, limits disable the ends", () => {
  const c = render(states({ target: 40, run: 15 }));
  const got = actions(c);
  c._el.target.up.click();
  c._el.target.up.click(); // the second tap builds on the first before HA confirms
  c._el.runtime.dn.click();
  same(perf(got), [
    ["input_number.set_value", "input_number.soil_balcony_value", { value: 45 }],
    ["input_number.set_value", "input_number.soil_balcony_value", { value: 50 }],
    ["input_number.set_value", "input_number.watervalve_balcony_timer_value", { value: 14 }],
  ]);
  assert.strictEqual(read(c).target, "50");
  assert.strictEqual(read(c).run, "14");
  let r = read(render(states({ target: 80, run: 1 })));
  assert(r.tDn && !r.tUp && !r.rDn && r.rUp);
  r = read(render(states({ target: 20, run: 30 })));
  assert(!r.tDn && r.tUp && r.rDn && !r.rUp);
});

test("pending stepper value gives way to HA's value after confirmation or timeout", () => {
  let now = NOW;
  const c = render(states({ target: 40 }));
  c._now = () => now;
  c._el.target.up.click();
  assert.strictEqual(read(c).target, "45");
  c.hass = hass(states({ target: 45 }));
  assert.strictEqual(read(c).target, "45");
  c._el.target.up.click();
  now += 5000;
  c._update();
  assert.strictEqual(read(c).target, "45", "not confirmed in time: back to the helper's value");
});

test("Water now uses the pending run time", () => {
  const c = render(states({ run: 15 }));
  c._el.runtime.up.click();
  const got = actions(c);
  c._el.water.click();
  same(perf(got)[1], ["timer.start", "timer.watervalve_balcony", { duration: "00:16:00" }]);
});

test("tap opens the details pop-up; a row opens more-info", () => {
  const c = render(states({ status: "water_shortage", sbat: 7 }));
  const ev = (type) => new w.Event(type, { bubbles: true });
  c._el.txt.dispatchEvent(ev("pointerdown"));
  c._el.txt.dispatchEvent(ev("pointerup"));
  const d = c._el.dialog;
  assert(d.hasAttribute("open") || d.open, "dialog open");
  const txt = d.textContent;
  for (const s of ["Moisture", "310 µS/cm", "16.4 °C", "5,400 lx", "Sensor battery", "7 %", "water shortage", "Used today", "Started", "15 min 5 s", "42 L", "Season (automation)", "below 40 %", "15 min", "03:00–06:00"]) {
    assert(txt.includes(s), `details show ${s}`);
  }
  const got = actions(c);
  d.querySelector('.row[data-entity="sensor.soil_sensor_vegtable_garden_1_conductivity"]').click();
  assert.strictEqual(got[0].config.entity, "sensor.soil_sensor_vegtable_garden_1_conductivity");
  assert.strictEqual(got[0].config.tap_action.action, "more-info");
  assert(!d.hasAttribute("open"), "closed before more-info");
});

test("details note when Water now is off for the season", () => {
  const c = render(states({ season: "off" }));
  c._openDetails();
  assert(/Water now is off while the season is off/.test(c._el.dialog.textContent));
});

test("tap_action set: goes to HA instead of the pop-up; hold: more-info of the valve", async () => {
  const c = render(states(), { tap_action: { action: "navigate", navigation_path: "/garden" } });
  const got = actions(c);
  c._tap();
  assert.strictEqual(got[0].config.tap_action.action, "navigate");
  assert(!c._el.dialog.hasAttribute("open"));
  c._el.txt.dispatchEvent(new w.Event("pointerdown"));
  await new Promise((r) => setTimeout(r, 550));
  assert.strictEqual(got[1].config.hold_action.action, "more-info");
  assert.strictEqual(got[1].config.entity, "switch.watervalve_balcony");
});

test("parts switched off with null: steppers, season button", () => {
  const c = render(states(), { entities: { target: null, automation: null } });
  assert.strictEqual(c._el.target.box.style.display, "none");
  assert.strictEqual(c._el.season.style.display, "none");
  assert(read(c).water, "no automation known: Water now allowed");
  const c2 = render(states(), { entities: { target: null, run_time: null } });
  assert.strictEqual(c2._el.ctl.style.display, "none");
});

test("re-render only on own entity changes", () => {
  const c = render(states());
  let n = 0;
  const orig = c._update.bind(c);
  c._update = () => { n++; orig(); };
  const s = states();
  c.hass = hass({ ...c.hass.states, "light.other": st("on") });
  assert.strictEqual(n, 0);
  c.hass = hass(s);
  assert.strictEqual(n, 1);
});

test("config errors", () => {
  const bad = (cfg, re) => assert.throws(() => new Card().setConfig(cfg), re);
  bad({ foo: 1 }, /Unknown option 'foo'/);
  bad({ entities: { valv: "switch.x" } }, /unknown role 'valv'/);
  bad({ entities: { valve: "nope" } }, /not an entity id/);
  bad({ entities: { valve: null } }, /valve is required/);
  bad({ low_battery: 120 }, /low_battery/);
  bad({ window_start: "25:00" }, /window_start/);
  bad({ water_now: "never" }, /water_now/);
  bad({ tap_action: "more-info" }, /tap_action/);
  bad({ colors: "red" }, /colors/);
  new Card().setConfig({ grid_options: { columns: 12, rows: 3 }, visibility: [] });
});

test("editor: defaults shown, nothing written for defaults", () => {
  const data = Editor.toData({ type: "custom:irrigation-card" });
  assert.strictEqual(data.entities.valve, "switch.watervalve_balcony");
  assert.strictEqual(data.window_start, "03:00:00");
  assert.strictEqual(data.low_battery, 15);
  assert.strictEqual(data.water_now, "season");
  same(Editor.toConfig(data, { type: "custom:irrigation-card" }), { type: "custom:irrigation-card" });
});

test("editor: round trips, nulls, unknown keys kept, every config accepted", () => {
  const prev = { type: "custom:irrigation-card", grid_options: { columns: 12, rows: 3 }, entities: { sun: null } };
  const data = Editor.toData(prev);
  assert.strictEqual(data.entities.sun, "");
  data.name = "Balcony";
  data.entities.flow = "";
  data.entities.valve = "";
  data.entities.moisture = "sensor.other_moisture";
  data.window_end = "07:30:00";
  data.stale_after = 12;
  data.water_now = "always";
  data.colors = { water: "teal", warn: "" };
  const cfg = Editor.toConfig(data, prev);
  same(cfg, {
    type: "custom:irrigation-card",
    grid_options: { columns: 12, rows: 3 },
    name: "Balcony",
    entities: { flow: null, moisture: "sensor.other_moisture", sun: null },
    window_end: "07:30",
    stale_after: 12,
    water_now: "always",
    colors: { water: "teal" },
  });
  new Card().setConfig(cfg);
  same(Editor.toConfig(Editor.toData(cfg), cfg), cfg);
});

test("colours set CSS variables", () => {
  const c = render(states(), { colors: { water: "teal" } });
  assert.strictEqual(c.style.getPropertyValue("--ir-water"), "teal");
});

test("card picker entry once", () => {
  assert.strictEqual(w.customCards.filter((x) => x.type === "irrigation-card").length, 1);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.stack.split("\n").slice(0, 3).join("\n     ")}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
