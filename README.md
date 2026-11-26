# Smearoo

Tap a paint bucket, then tap the sheet to plop paint. You can also drag straight from a bucket onto the paper. Each finger keeps its own paint as it moves, and strokes mix where they overlap. Fast swipes make splatters. Set the painting aside for ten seconds to watch the camera tour it.

Hold the three dots or press **Esc** to open the studio menu. **F1** opens Starhermit options, including volume controls.

## Run and build

Use Starhermit **1.50.0**. From the project folder:

```sh
starhermit .
```

The compiled paint module is included. After changing Rust, rebuild it and validate the game. The optional path creates a ready-to-serve web package outside the source directory.

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked
tools/build.sh /tmp/smearoo-web
```

Set `STARHERMIT` to the full runtime path if it is outside your PATH. Serve the web package over HTTP, opening `index.html` through the server. The web loader fetches the pinned Starhermit runtime.

To replay the native input and rendering smoke test:

```sh
mkdir -p /tmp/smearoo-shots
STARHERMIT_RENDER_CHECK_PNG=/tmp/smearoo-shots starhermit . --render-check --script tools/smoke.play
```

## Paint performance

Run the same render check with `--quality molecular --script tools/paint-bench.play` for the high-DPI portrait stress test. It measures tap, rapid swipe and two-finger painting at 390 × 844 logical pixels with a 3× device scale. Read `profile_json` for frame and game-thread p95.

On a Galaxy S24 Ultra (SM-S928B), the Starhermit 1.50 Android runtime ran the same touch sequence at molecular quality, scaled to the phone’s active 720 × 1560 display. The three VSync-paced runs had p95 frame intervals of 26.27, 28.20, and 28.02 ms. Each was below the 33.33 ms budget for 30 FPS.

The cover illustration was generated with FLUX.2 Klein. The seven effects were generated with MOSS-SoundEffect v2, then trimmed and leveled for the game. The asset tool uses Pillow and FFmpeg to rebuild the procedural paper texture, cursor, and music.
