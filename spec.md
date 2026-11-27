# Smearoo

Smearoo is a free-form fingerpainting studio for toddlers. One screen contains a paper sheet, a left column of six colorful buckets, and a small hold-to-open studio menu. There is no score or timer during painting.

- Tap a color bucket, then tap the sheet for a plop. Drag to carry wet pigment into the next part of the stroke. Overlapping strokes blend, and fast swipes or painting right after quick bucket changes scatter droplets.
- After ten seconds of inactivity with paint on the page, a gallery view slowly pans and zooms over the artwork. Input brings back the studio.
- The studio supports a mouse or up to ten independently painted touch strokes. Each finger keeps the color it starts with and can dip directly into a bucket before painting. Starting a fresh sheet asks for confirmation. The menu opens Starhermit options or quits the game.

The engine handles input, rendering, audio, localization, and menus. Rust/WebAssembly handles the pigment simulation, paint lighting, and fixed-step gallery timing. The game runs locally as a guest.

On engine 1.53.0, browser play through WebGL 2 compiles a frame's shader programs together and holds that frame until they are linked, blends skinned meshes in one pass, reuses the window pass's depth, and uses a hardware WebGL 2 context when WebGPU's adapter is software.
