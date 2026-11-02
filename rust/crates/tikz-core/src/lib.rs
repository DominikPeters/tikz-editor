#![forbid(unsafe_code)]
//! tikz-core: the Safe-Rust port of the tikz-editor core pipeline.
//!
//! Pipeline shape mirrors the TypeScript original's
//! `parse → semantic evaluate → SVG emit` form, but the Rust crate splits
//! each stage into `<= 400` LOC modules with doc-tested public APIs. The
//! iterative canvas model lives in the `tikz-app` egui shell.

pub mod adornment;
pub mod ast;
pub mod braces;
pub mod coordinate;
pub mod figure_scan;
pub mod foreach;
pub mod ids;
pub mod item_types;
pub mod items;
pub mod items_ops;
pub mod options;
pub mod option_classify;
pub mod prng;
pub mod region;
pub mod render;
pub mod scene;
pub mod span;
pub mod split;
pub mod stmt_foreach;
pub mod stmt_macro;
pub mod stmt_style;
pub mod tex_lex;
pub mod tok;
pub mod svg_emit;
pub mod svg_numbers;
pub mod units;
