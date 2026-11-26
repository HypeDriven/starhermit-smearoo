use std::cell::RefCell;

const TILE: usize = 48;
const COLS: usize = 16;
const ROWS: usize = 12;
const WIDTH: usize = TILE * COLS;
const HEIGHT: usize = TILE * ROWS;
const TILE_COUNT: usize = COLS * ROWS;
const PALETTE: [[f32; 6]; 6] = [
    [1., 0., 0., 0., 0., 0.],
    [0., 1., 0., 0., 0., 0.],
    [0., 0., 1., 0., 0., 0.],
    [0., 0., 0., 1., 0., 0.],
    [0., 0., 0., 0., 1., 0.],
    [0., 0., 0., 0., 0., 1.],
];
const RGB: [[f32; 3]; 6] = [
    [247., 77., 108.],
    [255., 151., 66.],
    [255., 211., 62.],
    [72., 196., 133.],
    [65., 156., 246.],
    [155., 113., 240.],
];
// Secondary pigments for adjacent primary pairs on a red/yellow/blue wheel.
const MIXES: [(usize, usize, usize); 3] = [(0, 2, 1), (2, 4, 3), (4, 0, 5)];

#[derive(Clone, Copy, Default)]
struct Cell {
    pigment: [f32; 6],
    depth: f32,
}

impl Cell {
    fn blend(&mut self, incoming: [f32; 6], amount: f32) {
        // Higher pressure replenishes opacity while keeping the old pigment wet.
        let weight = amount / (amount + self.depth).max(0.001);
        for (component, source) in self.pigment.iter_mut().zip(incoming) {
            *component += (source - *component) * weight;
        }
        self.depth += (1. - self.depth) * amount.min(1.);
    }

    fn rgba(self, relief: f32, grain: f32) -> [u8; 4] {
        let mut paints = self.pigment;
        for (first, second, mixed) in MIXES {
            let reaction = paints[first].min(paints[second]);
            paints[first] -= reaction;
            paints[second] -= reaction;
            paints[mixed] += 2. * reaction;
        }

        let mut rgb = [0.; 3];
        for (paint, color) in paints.into_iter().zip(RGB) {
            for channel in 0..3 {
                rgb[channel] += paint * color[channel];
            }
        }
        let shadow = 1. + relief.min(0.) * 0.6 + grain * 0.024;
        let sheen = relief.clamp(0., 0.7) * 0.7;
        let color = rgb.map(|channel| (channel + (255. - channel) * sheen) * shadow);
        [
            color[0] as u8,
            color[1] as u8,
            color[2] as u8,
            (self.depth * 255.) as u8,
        ]
    }
}

#[derive(Clone, Copy)]
struct Stroke {
    x: f32,
    y: f32,
    load: [f32; 6],
    aspect: f32,
    next_splatter: f32,
}

struct Paper {
    cells: Vec<Cell>,
    pixels: Vec<u8>,
    dirty: [bool; TILE_COUNT],
    strokes: [Option<Stroke>; 10],
    seed: u32,
    focal: Option<(f32, f32)>,
    idle: f32,
    previous_show: f32,
    show: f32,
}

impl Paper {
    fn new() -> Self {
        Self {
            cells: vec![Cell::default(); WIDTH * HEIGHT],
            pixels: vec![0; TILE * TILE * 4],
            dirty: [false; TILE_COUNT],
            strokes: [None; 10],
            seed: 1288293,
            focal: None,
            idle: 0.,
            previous_show: 0.,
            show: 0.,
        }
    }

    fn activity(&mut self) {
        self.idle = 0.;
        self.previous_show = 0.;
        self.show = 0.;
    }

    fn random(&mut self) -> f32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        (self.seed >> 8) as f32 / 16_777_216.
    }

    fn dab(
        &mut self,
        center: (f32, f32),
        radius: f32,
        aspect: f32,
        amount: f32,
        load: &mut [f32; 6],
    ) {
        let (x, y) = center;
        let left = ((x - radius * aspect - 1.) as i32).clamp(0, WIDTH as i32) as usize;
        let right = ((x + radius * aspect + 2.) as i32).clamp(0, WIDTH as i32) as usize;
        let top = ((y - radius / aspect - 1.) as i32).clamp(0, HEIGHT as i32) as usize;
        let bottom = ((y + radius / aspect + 2.) as i32).clamp(0, HEIGHT as i32) as usize;
        if left >= right || top >= bottom {
            return;
        }

        let mut picked = [0.; 6];
        let mut picked_weight = 0.;
        let mut touched_weight = 0.;
        let ridge_step = (0.49 / aspect).sin_cos();
        let radius_squared = radius * radius;
        let fade = (radius * 0.16 + 0.8).recip();
        for row in top..bottom {
            let dy = (row as f32 - y) * aspect;
            let first_dx = (left as f32 - x) / aspect;
            let (mut ridge_sin, mut ridge_cos) = (first_dx * 0.49 + dy * 0.32).sin_cos();
            for col in left..right {
                let ridge = 0.83 + 0.17 * (0.5 + 0.5 * ridge_sin);
                // Sample the same sinusoid as the brush advances one pixel.
                (ridge_sin, ridge_cos) = (
                    ridge_sin * ridge_step.1 + ridge_cos * ridge_step.0,
                    ridge_cos * ridge_step.1 - ridge_sin * ridge_step.0,
                );
                let dx = (col as f32 - x) / aspect;
                let distance_squared = dx * dx + dy * dy;
                if distance_squared >= radius_squared {
                    continue;
                }
                let edge = (radius - distance_squared.sqrt()) * fade;
                let weight = edge.min(1.) * ridge;
                let cell = &mut self.cells[row * WIDTH + col];
                let pickup = cell.depth * weight;
                touched_weight += weight;
                picked_weight += pickup;
                for (channel, previous) in picked.iter_mut().zip(cell.pigment) {
                    *channel += previous * pickup;
                }
                cell.blend(*load, amount * weight);
            }
        }
        if picked_weight > 0. {
            let carry = 0.26 * picked_weight / touched_weight;
            for (channel, previous) in load.iter_mut().zip(picked) {
                *channel += (previous / picked_weight - *channel) * carry;
            }
        }
        let left_tile = left.saturating_sub(1) / TILE;
        let top_tile = top.saturating_sub(1) / TILE;
        for row in top_tile..=(bottom.min(HEIGHT - 1) / TILE) {
            for col in left_tile..=(right.min(WIDTH - 1) / TILE) {
                self.dirty[row * COLS + col] = true;
            }
        }
    }

    fn splash(
        &mut self,
        center: (f32, f32),
        direction: (f32, f32),
        load: [f32; 6],
        aspect: f32,
        count: usize,
    ) {
        for _ in 0..count {
            let spread = 12. + self.random() * 34.;
            let across = (self.random() - 0.5) * 1.7;
            let radius = 2. + self.random() * 5.6;
            let x = center.0 + spread * (direction.0 - direction.1 * across);
            let y = center.1 + spread * (direction.1 + direction.0 * across);
            let mut droplet = load;
            self.dab((x, y), radius, aspect, 0.88, &mut droplet);
        }
    }

    fn begin(&mut self, slot: usize, x: f32, y: f32, color: usize, rapid: bool, aspect: f32) {
        self.activity();
        let Some(mut load) = PALETTE.get(color).copied() else {
            return;
        };
        self.dab((x, y), 24., aspect, 0.97, &mut load);
        let angle = self.random() * std::f32::consts::TAU;
        self.splash(
            (x, y),
            (angle.cos(), angle.sin()),
            load,
            aspect,
            if rapid { 9 } else { 3 },
        );
        self.strokes[slot] = Some(Stroke {
            x,
            y,
            load,
            aspect,
            next_splatter: 0.,
        });
        self.focal = Some((x, y));
    }

    fn drag(&mut self, slot: usize, x: f32, y: f32, seconds: f32) -> bool {
        self.activity();
        let Some(mut stroke) = self.strokes[slot] else {
            return false;
        };
        let dx = x - stroke.x;
        let dy = y - stroke.y;
        let distance = dx.hypot(dy);
        if distance < 1.5 {
            return false;
        }
        let speed = distance / seconds.max(1. / 120.);
        let steps = (distance / 7.).ceil() as usize;
        let radius = (20. - speed * 0.004).clamp(13., 20.);
        for step in 1..=steps {
            let t = step as f32 / steps as f32;
            self.dab(
                (stroke.x + dx * t, stroke.y + dy * t),
                radius,
                stroke.aspect,
                0.43,
                &mut stroke.load,
            );
        }
        stroke.next_splatter -= seconds;
        let splatter = speed > 1250. && distance > 19. && stroke.next_splatter <= 0.;
        if splatter {
            self.splash(
                (x, y),
                (dx / distance, dy / distance),
                stroke.load,
                stroke.aspect,
                8,
            );
            stroke.next_splatter = 0.19;
        }
        self.strokes[slot] = Some(Stroke { x, y, ..stroke });
        self.focal = Some(
            self.focal
                .map_or((x, y), |(a, b)| (a * 0.90 + x * 0.10, b * 0.90 + y * 0.10)),
        );
        splatter
    }

    fn tick(&mut self, dt: f32) -> bool {
        self.previous_show = self.show;
        if self.focal.is_none() || self.strokes.iter().any(Option::is_some) {
            self.activity();
            return false;
        }
        self.idle += dt;
        let started = self.idle >= 10. && self.idle - dt < 10.;
        self.show = (self.idle - 10.).max(0.);
        started
    }

    fn shade_tile(&mut self, tile: usize) -> bool {
        if !std::mem::take(&mut self.dirty[tile]) {
            return false;
        }
        let origin_x = tile % COLS * TILE;
        let origin_y = tile / COLS * TILE;
        for row in 0..TILE {
            let y = row + origin_y;
            for col in 0..TILE {
                let x = col + origin_x;
                let index = y * WIDTH + x;
                let cell = self.cells[index];
                let offset = (row * TILE + col) * 4;
                let pixel = if cell.depth > 0. {
                    let left = self.cells[y * WIDTH + x.saturating_sub(1)].depth;
                    let up = self.cells[y.saturating_sub(1) * WIDTH + x].depth;
                    let relief = cell.depth - (left + up) * 0.5;
                    let noise = (((x * 1337) ^ (y * 6971)) % 31) as f32 / 15. - 1.;
                    cell.rgba(relief, noise)
                } else {
                    [0; 4]
                };
                self.pixels[offset..offset + 4].copy_from_slice(&pixel);
            }
        }
        true
    }
}

thread_local! {
    static PAPER: RefCell<Paper> = RefCell::new(Paper::new());
}

#[no_mangle]
pub extern "C" fn activity() {
    PAPER.with_borrow_mut(Paper::activity);
}
#[no_mangle]
pub extern "C" fn begin(slot: usize, x: f32, y: f32, color: usize, rapid: bool, aspect: f32) {
    PAPER.with_borrow_mut(|paper| paper.begin(slot, x, y, color, rapid, aspect.clamp(0.5, 2.)));
}
#[no_mangle]
pub extern "C" fn drag(slot: usize, x: f32, y: f32, dt: f32) -> bool {
    PAPER.with_borrow_mut(|paper| paper.drag(slot, x, y, dt))
}
#[no_mangle]
pub extern "C" fn end(slot: usize) {
    PAPER.with_borrow_mut(|paper| paper.strokes[slot] = None);
}
#[no_mangle]
pub extern "C" fn clear() {
    PAPER.with_borrow_mut(|paper| {
        paper.cells.fill(Cell::default());
        paper.strokes.fill(None);
        paper.focal = None;
        paper.dirty.fill(false);
        paper.activity();
    });
}
#[no_mangle]
pub extern "C" fn tick(dt: f32) -> bool {
    PAPER.with_borrow_mut(|paper| paper.tick(dt))
}
#[no_mangle]
pub extern "C" fn show_time(alpha: f32) -> f32 {
    PAPER.with_borrow(|paper| paper.previous_show + (paper.show - paper.previous_show) * alpha)
}
#[no_mangle]
pub extern "C" fn focus_x() -> f32 {
    PAPER.with_borrow(|paper| paper.focal.map_or(0.5, |p| p.0 / WIDTH as f32))
}
#[no_mangle]
pub extern "C" fn focus_y() -> f32 {
    PAPER.with_borrow(|paper| paper.focal.map_or(0.5, |p| p.1 / HEIGHT as f32))
}
#[no_mangle]
pub extern "C" fn shade_next(start: usize) -> i32 {
    PAPER.with_borrow_mut(|paper| {
        let Some(index) = (start..TILE_COUNT).find(|&index| paper.dirty[index]) else {
            return -1;
        };
        paper.shade_tile(index);
        index as i32
    })
}
#[no_mangle]
pub extern "C" fn pixels() -> *const u8 {
    PAPER.with_borrow(|paper| paper.pixels.as_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_pairs_mix_to_secondary_pigments() {
        for (a, b, mixed) in MIXES {
            let mut cell = Cell {
                pigment: PALETTE[a],
                depth: 1.,
            };
            cell.blend(PALETTE[b], 1.);
            assert_eq!(
                cell.rgba(0., 0.),
                Cell {
                    pigment: PALETTE[mixed],
                    depth: 1.
                }
                .rgba(0., 0.)
            );
        }
    }

    #[test]
    fn drag_picks_up_color_and_fills_the_gap() {
        let mut paper = Paper::new();
        paper.begin(0, 99., 105., 2, false, 1.);
        paper.begin(1, 50., 105., 4, false, 1.);
        assert!(paper.drag(1, 250., 105., 0.08));
        let carried = paper.cells[105 * WIDTH + 130];
        assert!(carried.depth > 0.7);
        assert!(carried.pigment[2] > 0.04 && carried.pigment[4] > 0.04);
        assert!(paper.cells[105 * WIDTH + 240].depth > 0.7);
        assert!(paper.shade_tile(2 * COLS + 2));
        assert!(!paper.shade_tile(2 * COLS + 2));
    }

    #[test]
    fn idle_show_waits_for_paint_and_restarts_on_activity() {
        let mut paper = Paper::new();
        assert!(!paper.tick(30.));
        paper.begin(0, 10., 10., 1, false, 1.);
        assert!(!paper.tick(15.));
        paper.strokes[0] = None;
        assert!(!paper.tick(9.9));
        assert!(paper.tick(0.2));
        assert!(paper.show > 0.);
        assert!(!paper.tick(1.));
        paper.activity();
        assert_eq!(paper.show, 0.);
    }
}
