//! Deterministic PRNG parity layer shared by the corpus fuzzer and any seed-
//! driven sampling in the editor. Must produce identical streams on every
//! platform (no OS randomness, no float tricks, tiny interface).

/// SplitMix64-backed xorshift+ shrike: platform-stable across all targets.
/// Round-trip parity contract with the Python/TS golden fuzz driver:
/// `next_u64 % N` is the only derived quantities we rely on.
#[derive(Clone, Debug)]
pub struct Prng {
    state: [u64; 4],
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn xorshift128plus_mix(state: u64) -> u64 {
    let mut x = state;
    x ^= x >> 12;
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 27;
    x
}

impl Prng {
    /// Deterministically expand one `u64` seed into the 4-word state.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        let mut sm = seed;
        let s0 = splitmix64(&mut sm);
        let s1 = splitmix64(&mut sm);
        let s2 = splitmix64(&mut sm);
        let s3 = splitmix64(&mut sm);
        Self {
            state: [
                s0,
                s1,
                s2.wrapping_add(0x9E37_79B9_7F4A_7C15),
                xorshift128plus_mix(s3),
            ],
        }
    }

    /// Next raw `u64` (xorshift+ over the 4-word state).
    #[must_use]
    pub fn next_u64(&mut self) -> u64 {
        let s = &mut self.state;
        let (a, b, c) = (s[0], s[1], s[2]);
        let mut d = s[3];
        let t = a ^ (a << 11);
        d ^= t ^ d.rotate_left(7);
        s[0] = b;
        s[1] = c;
        s[2] = d;
        s[3] = (d ^ (d >> 19)) ^ (t ^ (t >> 8));
        s[3]
    }

    /// Uniform value in `[0, n)`; panics for `n == 0` (programmer error only —
    /// internal callers guard).
    #[must_use]
    pub fn below(&mut self, n: u64) -> u64 {
        debug_assert!(n > 0, "Prng::below requires n > 0 (bad caller)");
        self.next_u64() % n.max(1)
    }

    /// Uniform f32 in `[lo, hi)`; deliberate determinism over statistical
    /// purity (no rejection sampling).
    #[must_use]
    pub fn f32_in(&mut self, lo: f32, hi: f32) -> f32 {
        let u = self.next_u64() & 0x00FF_FFFF;
        let frac = u as f32 / 0x0100_0000 as f32;
        lo + (hi - lo) * frac
    }

    /// Choose an item from a slice (assumes non-empty; internal callers guard).
    #[must_use]
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        let n = u64::try_from(items.len()).ok().filter(|&n| n > 0);
        let n = match n {
            Some(n) => n,
            None => {
                // Call invariant violated: fall through to selection of element 0.
                return items
                    .iter()
                    .next()
                    .expect("Prng::pick requires non-empty slice");
            }
        };
        let idx = usize::try_from(self.below(n)).unwrap_or(0);
        &items[idx]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_across_instances() {
        let mut a = Prng::new(20_261_101);
        let mut b = Prng::new(20_261_101);
        for _ in 0..256 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Prng::new(1);
        let mut b = Prng::new(2);
        assert_ne!(a.next_u64(), b.next_u64());
    }

    #[test]
    fn below_stays_in_range() {
        let mut p = Prng::new(42);
        for _ in 0..1000 {
            assert!(p.below(7) < 7);
        }
    }

    #[test]
    fn f32_in_respects_bounds() {
        let mut p = Prng::new(9);
        for _ in 0..1000 {
            let v = p.f32_in(-2.0, 5.0);
            assert!((-2.0..5.0).contains(&v));
        }
    }
}
