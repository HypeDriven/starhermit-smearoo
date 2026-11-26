# Smearoo

Smearoo is a free-form fingerpainting studio for toddlers. One screen contains a paper sheet, six colorful buckets, sound, and the studio menu. There is no score or timer during painting.

- Tap a color bucket, then tap the sheet for a plop. Drag to carry wet pigment into the next part of the stroke. Overlapping strokes blend, and fast swipes or painting right after quick bucket changes scatter droplets.
- After ten seconds of inactivity with paint on the page, a gallery view slowly pans and zooms over the artwork. Input brings back the studio.
- The studio supports mouse and multitouch. Starting a fresh sheet asks for confirmation. The menu opens Starhermit options or quits the game.

The engine handles input, rendering, audio, localization, and menus. Rust/WebAssembly handles the pigment simulation, paint lighting, and fixed-step gallery timing. The game runs locally as a guest.
