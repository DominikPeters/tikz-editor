#![forbid(unsafe_code)]
//! `tikz-cli`: headless renderer used for golden parity checks.
//!
//! ```text
//! tikz-cli render <input.tex> <output.svg>
//! ```
//!
//! Exit codes: `0` ok, `2` usage or I/O error, `3` the document uses TikZ
//! the port does not support yet (diagnostics on stderr, no SVG written).

use std::process::ExitCode;
use tikz_core::render::{render_tex, Diagnostic};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [cmd, input, output] if cmd == "render" => render(input, output),
        _ => {
            eprintln!("usage: tikz-cli render <input.tex> <output.svg>");
            ExitCode::from(2)
        }
    }
}

fn render(input: &str, output: &str) -> ExitCode {
    let source = match std::fs::read_to_string(input) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("{input}: {e}");
            return ExitCode::from(2);
        }
    };
    match render_tex(&source) {
        Ok(svg) => match std::fs::write(output, svg) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("{output}: {e}");
                ExitCode::from(2)
            }
        },
        Err(diagnostics) => {
            for d in &diagnostics {
                eprintln!("{input}:{}", describe(&source, d));
            }
            ExitCode::from(3)
        }
    }
}

/// `line:col: message` for a diagnostic (1-based, counted in chars).
fn describe(source: &str, d: &Diagnostic) -> String {
    let before = &source[..d.span.from.min(source.len())];
    let line = before.matches('\n').count() + 1;
    let col = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    format!("{line}:{col}: {}", d.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tikz_core::span::Span;

    #[test]
    fn describe_reports_line_and_column() {
        let d = Diagnostic { span: Span::new(6, 8), message: "bad".into() };
        assert_eq!(describe("ab\ncd\nef", &d), "3:1: bad");
        let d = Diagnostic { span: Span::new(4, 5), message: "bad".into() };
        assert_eq!(describe("ab\ncd\nef", &d), "2:2: bad");
    }
}
