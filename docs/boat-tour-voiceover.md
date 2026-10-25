# Boat tour voice-over script

What the tour guide says to a player riding the ship at Crater Lake. The lines the game plays are in
`tools/narration/crater-lake.json`, and `tools/build_narration.py` speaks them with Kokoro into
`public/packs/crater-lake/audio/tour/`; change a line or the voice there and rerun the tool. Each stop
has two lines, matching the two moments the game announces (`src/engine/boat.ts`, `onArrive` and
`onDepart`):

- **arrive**: played as the ship comes to rest at the stop. She waits two minutes, so keep it under
  about 30 seconds.
- **depart**: played as she casts off, naming the next stop. Keep it under about 10 seconds.

The ship goes round counterclockwise, as the real tour does: Cleetwood Cove, Llao Rock, Devils
Backbone, Wizard Island, Phantom Ship, Pumice Castle, and back to Cleetwood Cove. She ties up only at
Cleetwood Cove and Wizard Island; at the other four she waits out on the water.

Theme, after the way Park Service rangers build a tour around one idea: a mountain destroyed itself
here, and what it left is one of the cleanest and calmest places on earth. The welcome sets that up
and the return to Cleetwood Cove closes it.

Voice direction: unhurried and warm, a guide who has made this trip a thousand times and still likes
it. No sales pitch, no exclamation. The voice is Kokoro's `af_heart` at 0.95 speed.

Pronunciation: Llao is "LAH-oh" (the JSON's `respell` makes the voice read it as "Lah-oh"). Mazama is
"muh-ZAH-muh". Cleetwood is "KLEET-wood".

No official ranger script was found online (searched 2026-10-03); rangers work from themes and
training manuals, not a published text, so this is our own. Its figures were checked against web
sources the same day: lake depth 1,943 ft and the collapse 7,700 years ago (nps.gov; some sources give
the depth as 1,949 ft), the Cleetwood survey of 1886, Wizard Island 767 ft above the lake, Llao Rock
about 1,870 ft above the lake, Phantom Ship 400,000 years old and as tall as a sixteen-storey
building, Pumice Castle about 1,300 ft above the lake, the Old Man a 30 ft hemlock log.

## Optional clips the game does not play yet

Nothing in the game triggers these today, so they are not in the JSON and are not spoken by the
tool. The last two are standard points on the real tour and would go on the long stretches between
stops.

**welcome** (on first boarding)

> Welcome aboard. Seven thousand seven hundred years ago a mountain stood here, a mile higher than
> the rim above us. It emptied itself in a few days and fell in. What it left is the deepest lake in
> the United States, nineteen hundred and forty-three feet of water, filled by nothing but rain and
> snow. Find a seat, or stand at the rail. There is no hurry here.

**clear_water** (between Wizard Island and Phantom Ship)

> No river runs into this lake and none runs out. Every drop fell here as rain or snow, so there is
> no silt and almost nothing growing in it. That is why the water is among the clearest in the
> world, and why it is this blue.

**old_man** (only if the Old Man of the Lake is added to the game)

> Keep an eye out for the Old Man of the Lake: a hemlock log, thirty feet long, floating bolt
> upright with a few feet of bleached wood above the water. He has been drifting around this lake,
> wherever the wind sends him, for well over a hundred years.
