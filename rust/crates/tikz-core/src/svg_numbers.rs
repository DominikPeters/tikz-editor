//! SVG number formatting, byte-compatible with the legacy emitter.
//!
//! Port of the number helper in `packages/core/src/svg/emit.ts`: a value is
//! rendered with JavaScript's `toFixed(4)`, passed through
//! `Number(..).toString()` so trailing zeros vanish, and collapses to `"0"`
//! when it is non-finite or smaller than `1e-9` in magnitude.
//!
//! The one trap is the tie rule. ECMAScript `Number.prototype.toFixed`
//! picks the *larger* `n` when two integers are equally close, while Rust's
//! `{:.4}` rounds half to even. They only disagree on values that are an
//! exact tie in binary (for example `0.03125`), so [`fmt_num`] detects an
//! exact tie from the full decimal expansion and rounds it up itself.
//!
//! ```
//! use tikz_core::svg_numbers::fmt_num;
//! assert_eq!(fmt_num(28.4527559055), "28.4528");
//! assert_eq!(fmt_num(0.4), "0.4");
//! assert_eq!(fmt_num(-0.00001), "0");
//! assert_eq!(fmt_num(0.03125), "0.0313"); // JS toFixed tie: larger n
//! ```

/// Format `value` exactly like the legacy `fmtNum` helper.
///
/// Magnitudes of `1e21` and above are out of contract (JS switches to
/// exponent notation there); drawings never reach them.
pub fn fmt_num(value: f64) -> String {
    if !value.is_finite() || value.abs() < 1e-9 {
        return "0".to_string();
    }
    let parsed: f64 = to_fixed4(value).parse().unwrap_or(0.0);
    if parsed == 0.0 {
        // Covers "-0.0000": `Number("-0.0000").toString()` is "0" in JS.
        return "0".to_string();
    }
    format!("{parsed}")
}

/// `value.toFixed(4)` with the ECMAScript larger-`n` tie rule.
///
/// ```
/// use tikz_core::svg_numbers::to_fixed4;
/// assert_eq!(to_fixed4(2.5), "2.5000");
/// assert_eq!(to_fixed4(-0.03125), "-0.0313");
/// ```
pub fn to_fixed4(value: f64) -> String {
    let negative = value < 0.0;
    let magnitude = value.abs();
    // `{:.40}` prints the exact binary expansion, so a tie shows up as a
    // lone `5` followed by zeros after the fourth decimal.
    let wide = format!("{magnitude:.40}");
    let dot = wide.find('.').unwrap_or(wide.len());
    let tail = wide.get(dot + 5..).unwrap_or("");
    let is_tie = tail.starts_with('5') && tail[1..].bytes().all(|b| b == b'0');
    let body = if is_tie {
        round_tie_up(&wide[..dot], &wide[dot + 1..dot + 5])
    } else {
        format!("{magnitude:.4}")
    };
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

/// Add one unit in the fourth decimal place to `int_part.frac4`.
fn round_tie_up(int_part: &str, frac4: &str) -> String {
    let digits = format!("{int_part}{frac4}");
    let bumped = digits.parse::<u128>().map_or(digits, |n| (n + 1).to_string());
    let padded = format!("{bumped:0>5}");
    let split = padded.len() - 4;
    format!("{}.{}", &padded[..split], &padded[split..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn plain_values_trim_trailing_zeros() {
        assert_eq!(fmt_num(0.0), "0");
        assert_eq!(fmt_num(12.0), "12");
        assert_eq!(fmt_num(-12.2), "-12.2");
        assert_eq!(fmt_num(52.8527559055), "52.8528");
    }

    #[test]
    fn non_finite_and_tiny_collapse_to_zero() {
        assert_eq!(fmt_num(f64::NAN), "0");
        assert_eq!(fmt_num(f64::INFINITY), "0");
        assert_eq!(fmt_num(f64::NEG_INFINITY), "0");
        assert_eq!(fmt_num(5e-10), "0");
        assert_eq!(fmt_num(-0.0), "0");
    }

    #[test]
    fn exact_ties_round_to_the_larger_integer() {
        // 312.5 / 10^4: Rust `{:.4}` would give 0.0312 (half-even).
        assert_eq!(to_fixed4(0.03125), "0.0313");
        assert_eq!(to_fixed4(-0.03125), "-0.0313");
        assert_eq!(to_fixed4(1.03125), "1.0313");
        assert_eq!(to_fixed4(0.09375), "0.0938");
        assert_eq!(to_fixed4(0.96875), "0.9688");
    }

    #[test]
    fn near_ties_follow_the_exact_binary_value() {
        // 0.00005 is stored slightly above the tie, 2.675 slightly below.
        assert_eq!(to_fixed4(0.00005), "0.0001");
        assert_eq!(to_fixed4(2.675), "2.6750");
        assert_eq!(to_fixed4(1.00005), "1.0001");
    }

    #[test]
    fn carries_propagate_through_a_tie() {
        assert_eq!(to_fixed4(0.99996875), "1.0000");
        assert_eq!(round_tie_up("9", "9999"), "10.0000");
    }

    proptest! {
        #[test]
        fn rounding_moves_values_by_at_most_half_a_unit(x in -1.0e6f64..1.0e6) {
            let back: f64 = fmt_num(x).parse().unwrap();
            prop_assert!((back - x).abs() <= 5.0e-5 + 1e-9);
        }

        #[test]
        fn output_never_has_exponent_or_trailing_zero(x in -1.0e9f64..1.0e9) {
            let s = fmt_num(x);
            prop_assert!(!s.contains('e'));
            if s.contains('.') {
                prop_assert!(!s.ends_with('0'));
            }
        }
    }
}
