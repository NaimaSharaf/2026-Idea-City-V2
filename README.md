# Idea City 1.0

A Chrome extension for a library of ideas, built from Presentation City. One page holds both views:

- **Entries**: the viewer and editor in one. Open the library folder, add ideas, tag them, link them, and sort them into station modules.
- **Station**: a space station built from your library. Each module is a pod docked to a central **Observation Deck** by glass docking tubes. Every idea is an astronaut.

Switch with the **Entries | Station** toggle at the top, **View on Station →**, or **Ctrl+Shift+S**. Both views stay open and share one folder, so edits in either view appear in the other within a few seconds.

## Install
1. Go to chrome://extensions, turn on Developer mode, click **Load unpacked**, and choose this folder.
2. Click the Idea City icon. The page opens on Entries.
3. Click **Open library folder** and choose a new, empty folder (for example `Ideas`). Idea City keeps its own folder; it refuses your Citations and Presentations libraries so they never mix.

## Entries
Each idea has:
- **Idea**: its name (the astronaut's label and the module's mission board)
- **Tags**: comma separated. Click **Your tags** under the form to reuse one. The first tag colours the astronaut's suit; more tags show as chest badges.
- **Notes**: one thought per line. The astronaut says them one at a time in its speech bubble.
- **Linked ideas**: use **＋ Link to another idea…** on an idea (or **Link to** when adding). Links are two-way and saved on both ideas; click a link chip to jump to it, × to unlink.

**Filter by tag** and **Search** narrow the list. Ideas above the first module are in the **Airlock**.

## Station
- **Spotlight**: each module puts one idea at its console for 30 seconds. A lightbulb hologram glows above it and the mission board shows the idea, its tags, the current thought, and how many links it has.
- **Crew**: everyone else works at a desk (their monitor lights up) or floats around the module in zero‑g.
- **Radio beams**: linked ideas are joined by animated beams. Show all, only the selected idea's, or none.
- **Meetings**: linked ideas meet at the Observation Deck, each cluster of linked ideas at its own table. Automatic (35 s every 2 minutes), **Now**, or **Never**.
- **🔭 Everyone to the Observation Deck** sends the whole crew there until you click **Back to the modules**.
- **Tags**: click a tag in the sidebar (or on an idea's card) to light up its astronauts and dim the rest.
- Click an astronaut to see its notes, tags and linked ideas (click a linked idea to fly to it). Drag or right‑click an astronaut to move it to another module.
- Build/erase walls, **Move module** (also moves the Deck), **Seal it in**, **Recolor** work as in Presentation City.

## Sync
Both views join the same sync journal as Paper City and the Overleaf Synced Library (`sync-base.json`, `changes/`, `session.json`). They show up in history as **Entries page** and **Station**. Module layout is saved on each module's section row (field `city`); the Airlock, loose walls and the Deck position are in `city.json`.

library.js and sync.js are copies from overleaf-synced-library. If you update them there, copy them here too.
