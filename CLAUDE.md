# Irrigation Card: notes for working on this repo

Marketplace (formerly HACS) dashboard card (Lovelace) for the garden watering on the owner's balcony / rear garden tap. Owner: BarBaar44 (Bb). Sister repos with the same conventions: [gardenview-house](https://github.com/BarBaar44/gardenview-house) (sits directly above this card on the Home view, section 3; same top row layout and drawing style), [appliance-card](https://github.com/BarBaar44/appliance-card) (the reference), [espresso-card](https://github.com/BarBaar44/espresso-card), [tesla-model3-card](https://github.com/BarBaar44/tesla-model3-card), [vacuum-card](https://github.com/BarBaar44/vacuum-card), [room-card](https://github.com/BarBaar44/room-card), [climate-card](https://github.com/BarBaar44/climate-card).

## Files

| File | Purpose |
|---|---|
| `irrigation-card.js` | The whole card: plain custom element, no build step, no dependencies. `IR_DEFAULTS` holds the owner's entities and thresholds, `IR_COLORS` the colours, `irScene` the drawing, `_state` / `_texts` the logic, `_fillDetails` the pop-up. |
| `tests/irrigation-card.test.js` | jsdom tests: texts, warnings, buttons, actions, steppers, details, config errors, editor round trips. `npm test`. |
| `hacs.json` | Manifest for the Home Assistant Marketplace. |
| `README.md` | User docs, also the Marketplace info page. Keep the option, role and decision tables in sync with the code. |
| `CHANGELOG.md` | One `## vX.Y.Z` section per release; the Release workflow uses it as the release notes. |
| `shot.png` | README image, linked by absolute raw URL. |
| `irrigation-card.yaml` | Minimal and full example configs. |

## The devices

* Valve: SONOFF Zigbee water valve via Zigbee2MQTT. `switch.watervalve_balcony` on = water flowing, `binary_sensor..._valve_work_state` = really open, `sensor..._current_device_status` `normal` / `water_shortage` (stays `water_shortage` after a shortage until the next run), auto close on shortage is on. Start / end time sensors are Unix seconds. The valve's own cyclic schedules are unused and not shown.
* Soil: Xiaomi Mi Flora (HHCCJCY01) over BLE, IDs spelled `vegtable`. BLE drops out, hence the stale warning. Its battery was 7 % in November 2026.
* Helpers: `input_number.soil_balcony_value` (target %, 20 to 80 step 5), `input_number.watervalve_balcony_timer_value` (run min, 1 to 30), `timer.watervalve_balcony`, `input_datetime.balconyvalvelaststarted`.
* Automation `automation.balcony_valve` ("Balcony watering"), on/off = season. Every 15 min and when the soil drops below the target: between 03:00 and 06:00, last start more than 30 min ago, soil below target → valve on, timer for the run time; timer finished → valve off. **Do not change the automation or helpers from here.**

## Rules to keep

* The card only calls `switch.turn_on/turn_off`, `timer.start/cancel`, `input_number.set_value`, `automation.turn_on/turn_off`, all as `perform-action` through `hass-action`. Never `hass.callService`.
* Water now is disabled while the automation is off (`water_now: season`, the default): the automation is what closes the valve when the timer ends. Do not make it the default to allow it; `water_now: always` exists for setups where something else closes the valve.
* Buttons only when they apply: Stop only while watering, the valve is open or the timer runs; Water now not while watering or unavailable; stepper ends disabled at the helper's min / max.
* Steppers use the helper's own step, min and max; a pending value shows at once and builds on itself until HA confirms it (or 4 s pass).
* Water shortage warns (name row, red LED and `!` in the picture) only while watering, the timer runs or the season is on (`shortage`); the details row uses the raw status (`shortageRaw`). The valve keeps `water_shortage` until its next run, so out of season it would warn all winter.
* Warnings go in the name row (first one plus `· +n`), never in the status line: the soil battery warning can last weeks and must not hide the status.
* Staleness uses `last_reported` (falls back to `last_updated` / `last_changed`) of every soil value: moisture can stay equal for hours.
* Last run comes from the valve's start / end sensors (also manual runs), with the input_datetime as fallback.
* Layout: 12 columns by 3 rows, 184 px. Top row (120 px) like Gardenview House: picture 191 × 112 at 520 px, 128 × 112 below 420 px card width (container query, both SVGs are in the DOM); status line has a short form below 200 px text width. Bottom row: two 40 px steppers. Measure in a real browser (Playwright) at 360 and 520 px after any text or layout change; a stub `ha-card` must not set `display` inline.
* Drawing: line art (white surfaces, `#111` outlines, softened red brick like Gardenview House). Rebuilt only when its inputs change (`_sceneKey`).
* The details pop-up is a native `<dialog>` (`showModal`, top layer), filled again on every update while open. Rows open more-info after closing it.
* Visual editor (`IrrigationCardEditor`, on `ha-form`): fields show the defaults; only non-defaults are written; a cleared entity with a default is written as `null` (a cleared valve falls back to the default); unknown keys are kept. Keep `IR_ENTITY_FIELDS` and `IR_NUMBER_FIELDS` in sync with `IR_DEFAULTS`.
* Animations (hose flow, drips) stop under reduced motion.
* The whole file sits in one block scope; `const VERSION` stays on its own line for the Release workflow.

## Releasing

1. Changes go through a pull request; Bb merges.
2. Bump `VERSION`, add the CHANGELOG section in the PR that is meant to become a release.
3. The owner pushes the `vX.Y.Z` tag, after the release PR is merged. **Never tag or release without the owner's explicit go.** Claude sessions here cannot push tags or create releases anyway.
4. The repo needs a description and the topics `hacs`, `hacs-dashboard`, `home-assistant`, `lovelace` under About, or HACS validation fails. Bb sets these.
