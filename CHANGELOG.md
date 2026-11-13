# Changelog

## v0.1.1

- Water shortage only warns while the season is on or while watering. The valve keeps reporting `water_shortage` until its next run, so out of season the warning stayed for months. The details pop-up still shows the status in amber.

## v0.1.0

First release.

- Line drawing of the tap, valve, hose and raised bed with the soil sensor: the soil darkens with moisture, water runs through the hose while the valve is open, moon at night, warning marks on the valve and sensor.
- Soil moisture with a bar and the target marked; countdown while watering; one status line (season off, tonight's window, watered, watering progress) with a short form for narrow cards.
- Warnings in the name row: water shortage, valve unavailable, soil sensor silent or unavailable, low batteries.
- Season button (the watering automation), Water now (valve on plus the timer for the run time), Stop (valve off plus timer cancel), steppers for target and run time.
- Water now only while the season is on by default (`water_now`), because the automation closes the valve when the timer ends.
- Details pop-up on tap: soil, valve, last run and watering settings; each row opens the entity.
- Visual editor.
