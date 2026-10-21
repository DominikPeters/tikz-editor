//! Whole-document PDF compiles (Beamer decks), latexmk-style: a build
//! directory kept per document, LaTeX rerun until its cross-references
//! settle, BibTeX or Biber when the document asks for one, and no compile
//! at all when neither the document nor any file it read has changed.

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

use crate::{
    format_command_failure, hash_text_for_revision, latex_compile_working_dir, read_text_if_exists,
    resolve_latex_compile_cwd, run_shell_command, CommandRunOutput,
};

/// A whole deck, with its pictures, can take minutes on a first run.
const COMPILE_TIMEOUT_SECS: u64 = 300;
const BIBLIOGRAPHY_TIMEOUT_SECS: u64 = 120;
const ENGINES: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];
/// LaTeX, BibTeX, LaTeX, LaTeX, and one more should a label still move.
const MAX_TEX_RUNS: usize = 4;
const JOB: &str = "input";

/// Compiles share build directories; one runs at a time.
static COMPILE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize)]
pub struct LatexPdfPayload {
    #[serde(rename = "pdfBase64")]
    pdf_base64: String,
    marks: String,
    log: String,
    /// Whether TeX or the bibliography tool reported errors; the PDF holds
    /// what TeX typeset regardless.
    #[serde(rename = "hadErrors")]
    had_errors: bool,
}

fn build_dir_for(build_key: &str) -> PathBuf {
    latex_compile_working_dir()
        .join("pdf")
        .join(hash_text_for_revision(build_key))
}

/// Compiles a whole document to PDF with the engine it asks for, in a build
/// directory kept per `build_key`, so that the .aux, .nav, .toc and .bbl of
/// one compile feed the next. Returns the PDF, the job's `.marks` file
/// (which the document may write for its caller) and the log.
#[tauri::command]
pub async fn desktop_compile_latex_pdf(
    latex_document: String,
    engine: String,
    source_directory: Option<String>,
    build_key: String,
    app: AppHandle,
) -> Result<LatexPdfPayload, String> {
    if !ENGINES.contains(&engine.as_str()) {
        return Err(format!("Unknown TeX engine: {engine}"));
    }
    let _guard = COMPILE_LOCK.lock().await;
    let build_dir = build_dir_for(&build_key);
    fs::create_dir_all(&build_dir).map_err(|e| {
        format!(
            "Failed to create build dir {}: {e}",
            build_dir.to_string_lossy()
        )
    })?;
    let source_dir = resolve_latex_compile_cwd(source_directory.as_deref());
    compile(
        &ShellRunner(&app),
        &latex_document,
        &engine,
        source_dir.as_deref(),
        &build_dir,
    )
    .await
}

/// Runs the TeX tools: the app's shell, or plain processes in tests.
trait CommandRunner {
    async fn run(
        &self,
        command: &str,
        args: &[String],
        working_dir: &Path,
        timeout_secs: u64,
        env: &[(&str, String)],
    ) -> Result<CommandRunOutput, String>;
}

struct ShellRunner<'a>(&'a AppHandle);

impl CommandRunner for ShellRunner<'_> {
    async fn run(
        &self,
        command: &str,
        args: &[String],
        working_dir: &Path,
        timeout_secs: u64,
        env: &[(&str, String)],
    ) -> Result<CommandRunOutput, String> {
        run_shell_command(self.0, command, args, working_dir, timeout_secs, env).await
    }
}

async fn compile(
    runner: &impl CommandRunner,
    latex_document: &str,
    engine: &str,
    source_dir: Option<&Path>,
    build_dir: &Path,
) -> Result<LatexPdfPayload, String> {
    let compile_cwd = source_dir.unwrap_or(build_dir);
    let job = |extension: &str| build_dir.join(format!("{JOB}.{extension}"));
    let state_path = job("state");

    if let Some(state) = CompileState::read(&state_path) {
        if state.is_current(engine, latex_document, &job("tex")) && job("pdf").exists() {
            return payload(build_dir, state.had_errors, state.notes);
        }
    }
    // A compile cut short must not pass for the last good one.
    let _ = fs::remove_file(&state_path);
    fs::write(job("tex"), latex_document).map_err(|e| {
        format!(
            "Failed to write .tex in {}: {e}",
            build_dir.to_string_lossy()
        )
    })?;

    let args = vec![
        "-interaction=batchmode".to_string(),
        "-file-line-error".to_string(),
        "-recorder".to_string(),
        format!("-output-directory={}", build_dir.to_string_lossy()),
        job("tex").to_string_lossy().to_string(),
    ];
    let first = !job("aux").exists();
    let mut notes = String::new();
    let mut had_errors;
    let mut runs = 0;
    loop {
        let _ = fs::remove_file(job("pdf"));
        let _ = fs::remove_file(job("marks"));
        let result = runner
            .run(engine, &args, compile_cwd, COMPILE_TIMEOUT_SECS, &[])
            .await?;
        runs += 1;
        if !job("pdf").exists() {
            return Err(format_command_failure(
                engine,
                result.status_code,
                &result.stdout,
                &result.stderr,
                Some(&job("log")),
                build_dir,
            ));
        }
        had_errors = result.status_code != Some(0);
        if had_errors {
            break;
        }
        let log = read_text_if_exists(&job("log"));
        let mut rerun = (first && runs == 1) || asks_rerun(&log);
        let bibliography = run_bibliography(runner, build_dir, source_dir).await;
        rerun |= bibliography.bbl_changed;
        if let Some(problem) = bibliography.problem {
            notes.push_str(&problem);
            notes.push('\n');
        }
        if !rerun || runs >= MAX_TEX_RUNS {
            break;
        }
    }
    let had_errors = had_errors || !notes.is_empty();
    let state = CompileState {
        engine: engine.to_string(),
        had_errors,
        notes: notes.clone(),
        inputs: compile_inputs(build_dir, source_dir),
    };
    state.write(&state_path);
    payload(build_dir, had_errors, notes)
}

fn payload(build_dir: &Path, had_errors: bool, notes: String) -> Result<LatexPdfPayload, String> {
    let pdf = fs::read(build_dir.join(format!("{JOB}.pdf")))
        .map_err(|e| format!("Failed to read PDF: {e}"))?;
    let mut log = read_text_if_exists(&build_dir.join(format!("{JOB}.log")));
    if !notes.is_empty() {
        log = format!("{notes}\n{log}");
    }
    Ok(LatexPdfPayload {
        pdf_base64: base64::engine::general_purpose::STANDARD.encode(pdf),
        marks: read_text_if_exists(&build_dir.join(format!("{JOB}.marks"))),
        log,
        had_errors,
    })
}

fn asks_rerun(log: &str) -> bool {
    log.contains("Rerun to get")
        || log.contains("may have changed. Rerun")
        || log.contains("Please rerun LaTeX")
        || log.contains("Please (re)run Biber")
}

struct BibliographyRun {
    bbl_changed: bool,
    problem: Option<String>,
}

/// Runs Biber (biblatex wrote a `.bcf`) or BibTeX (the `.aux` names a
/// `\bibdata`) when what it reads has changed since its last run: the
/// citations, or a `.bib` file. The `.bib` files are found in the source
/// directory before TeX's own paths.
async fn run_bibliography(
    runner: &impl CommandRunner,
    build_dir: &Path,
    source_dir: Option<&Path>,
) -> BibliographyRun {
    let quiet = BibliographyRun {
        bbl_changed: false,
        problem: None,
    };
    let bcf = build_dir.join(format!("{JOB}.bcf"));
    let aux = read_text_if_exists(&build_dir.join(format!("{JOB}.aux")));
    let (tool, request) = if bcf.exists() {
        ("biber", read_text_if_exists(&bcf))
    } else if aux.contains("\\bibdata{") {
        ("bibtex", bibtex_request(&aux))
    } else {
        return quiet;
    };
    let bbl_path = build_dir.join(format!("{JOB}.bbl"));
    let blg_path = build_dir.join(format!("{JOB}.blg"));
    let state_path = build_dir.join(format!("{JOB}.bibstate"));
    let signature = |blg: &str| {
        let mut signature = format!("{tool}\n{request}\n");
        for source in bibliography_sources(blg, source_dir, build_dir) {
            signature.push_str(&FileStamp::of(&source).line());
            signature.push('\n');
        }
        signature
    };
    if bbl_path.exists()
        && read_text_if_exists(&state_path) == signature(&read_text_if_exists(&blg_path))
    {
        return quiet;
    }
    let before = read_text_if_exists(&bbl_path);
    let env: Vec<(&str, String)> = source_dir
        .map(|dir| {
            // A trailing separator keeps TeX's own search path after it.
            let path = format!(
                "{}{}",
                dir.to_string_lossy(),
                if cfg!(windows) { ';' } else { ':' }
            );
            vec![("BIBINPUTS", path.clone()), ("BSTINPUTS", path)]
        })
        .unwrap_or_default();
    let result = runner
        .run(
            tool,
            &[JOB.to_string()],
            build_dir,
            BIBLIOGRAPHY_TIMEOUT_SECS,
            &env,
        )
        .await;
    let blg = read_text_if_exists(&blg_path);
    let problem = match result {
        Err(error) if error.starts_with("Failed to spawn") => Some(format!(
            "{} was not found, so citations are unresolved.",
            if tool == "biber" { "Biber" } else { "BibTeX" }
        )),
        Err(error) => Some(error),
        // BibTeX exits 1 on warnings alone.
        Ok(output) if output.status_code.unwrap_or(2) > i32::from(tool == "bibtex") => {
            Some(format!(
                "{} reported errors:\n{}",
                if tool == "biber" { "Biber" } else { "BibTeX" },
                blg.trim()
            ))
        }
        Ok(_) => None,
    };
    if problem.is_none() {
        let _ = fs::write(&state_path, signature(&blg));
    }
    BibliographyRun {
        bbl_changed: read_text_if_exists(&bbl_path) != before,
        problem,
    }
}

/// What BibTeX reads from the `.aux`: the citations, databases and style.
fn bibtex_request(aux: &str) -> String {
    aux.lines()
        .filter(|line| {
            line.starts_with("\\citation")
                || line.starts_with("\\bibdata")
                || line.starts_with("\\bibstyle")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The `.bib` files a bibliography run read, from its `.blg`.
fn bibliography_sources(blg: &str, source_dir: Option<&Path>, build_dir: &Path) -> Vec<PathBuf> {
    let mut sources = Vec::new();
    for line in blg.lines() {
        // BibTeX: "Database file #1: refs.bib"; Biber: "Found BibTeX data source '/path/refs.bib'".
        let name = if let Some(index) = line.find("Database file #") {
            line[index..].split_once(": ").map(|(_, name)| name.trim())
        } else if let Some(index) = line.find("data source '") {
            line[index + "data source '".len()..].split('\'').next()
        } else {
            None
        };
        let Some(name) = name.filter(|name| !name.is_empty()) else {
            continue;
        };
        let path = Path::new(name);
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            source_dir
                .map(|dir| dir.join(path))
                .filter(|candidate| candidate.exists())
                .unwrap_or_else(|| build_dir.join(path))
        };
        if !sources.contains(&resolved) {
            sources.push(resolved);
        }
    }
    sources
}

/// Every file a compile read, outside its build directory: the recorder's
/// INPUT lines (packages, images, `\input` files) and the `.bib` files.
fn compile_inputs(build_dir: &Path, source_dir: Option<&Path>) -> Vec<FileStamp> {
    let fls = read_text_if_exists(&build_dir.join(format!("{JOB}.fls")));
    let blg = read_text_if_exists(&build_dir.join(format!("{JOB}.blg")));
    let mut paths = recorded_inputs(&fls);
    paths.extend(bibliography_sources(&blg, source_dir, build_dir));
    let canonical_build = build_dir
        .canonicalize()
        .unwrap_or_else(|_| build_dir.to_path_buf());
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .filter(|path| !path.starts_with(build_dir) && !path.starts_with(&canonical_build))
        .map(|path| FileStamp::of(&path))
        .collect()
}

/// The INPUT files of a `-recorder` `.fls`, relative ones against its PWD.
fn recorded_inputs(fls: &str) -> Vec<PathBuf> {
    let mut pwd = PathBuf::new();
    let mut inputs = Vec::new();
    for line in fls.lines() {
        if let Some(dir) = line.strip_prefix("PWD ") {
            pwd = PathBuf::from(dir);
        } else if let Some(file) = line.strip_prefix("INPUT ") {
            let path = Path::new(file);
            inputs.push(if path.is_absolute() {
                path.to_path_buf()
            } else {
                pwd.join(path)
            });
        }
    }
    inputs
}

#[derive(Debug, PartialEq)]
struct FileStamp {
    path: PathBuf,
    /// Modification time in nanoseconds and size; none for a missing file.
    stamp: Option<(u128, u64)>,
}

impl FileStamp {
    fn of(path: &Path) -> Self {
        let stamp = fs::metadata(path).ok().map(|metadata| {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_nanos());
            (modified, metadata.len())
        });
        Self {
            path: path.to_path_buf(),
            stamp,
        }
    }

    fn line(&self) -> String {
        match self.stamp {
            Some((modified, size)) => format!("{modified} {size} {}", self.path.to_string_lossy()),
            None => format!("- - {}", self.path.to_string_lossy()),
        }
    }

    fn parse(line: &str) -> Option<Self> {
        let mut parts = line.splitn(3, ' ');
        let (modified, size, path) = (parts.next()?, parts.next()?, PathBuf::from(parts.next()?));
        let stamp = if modified == "-" {
            None
        } else {
            Some((modified.parse().ok()?, size.parse().ok()?))
        };
        Some(Self { path, stamp })
    }
}

/// What the last finished compile ran with, to tell whether another would
/// change anything.
struct CompileState {
    engine: String,
    had_errors: bool,
    notes: String,
    inputs: Vec<FileStamp>,
}

impl CompileState {
    fn write(&self, path: &Path) {
        let mut text = format!(
            "engine {}\nerrors {}\nnotes {}\n",
            self.engine,
            self.had_errors,
            self.notes.replace('\\', "\\\\").replace('\n', "\\n")
        );
        for input in &self.inputs {
            text.push_str("input ");
            text.push_str(&input.line());
            text.push('\n');
        }
        let _ = fs::write(path, text);
    }

    fn read(path: &Path) -> Option<Self> {
        let text = fs::read_to_string(path).ok()?;
        let mut lines = text.lines();
        let engine = lines.next()?.strip_prefix("engine ")?.to_string();
        let had_errors = lines.next()?.strip_prefix("errors ")? == "true";
        let notes = unescape_line(lines.next()?.strip_prefix("notes ")?);
        let inputs = lines
            .map(|line| line.strip_prefix("input ").and_then(FileStamp::parse))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            engine,
            had_errors,
            notes,
            inputs,
        })
    }

    /// The same engine and document, and every file it read unchanged.
    fn is_current(&self, engine: &str, latex_document: &str, tex_path: &Path) -> bool {
        self.engine == engine
            && fs::read_to_string(tex_path).is_ok_and(|previous| previous == latex_document)
            && self
                .inputs
                .iter()
                .all(|input| FileStamp::of(&input.path) == *input)
    }
}

fn unescape_line(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(char) = chars.next() {
        if char == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plain processes, noting each command run.
    struct ProcessRunner(std::sync::Mutex<Vec<String>>);

    impl CommandRunner for ProcessRunner {
        async fn run(
            &self,
            command: &str,
            args: &[String],
            working_dir: &Path,
            _timeout_secs: u64,
            env: &[(&str, String)],
        ) -> Result<CommandRunOutput, String> {
            self.0.lock().unwrap().push(command.to_string());
            let output = std::process::Command::new(command)
                .args(args)
                .current_dir(working_dir)
                .envs(env.iter().map(|(key, value)| (*key, value)))
                .output()
                .map_err(|e| format!("Failed to spawn `{command}`: {e}"))?;
            Ok(CommandRunOutput {
                status_code: output.status.code(),
                stdout: output.stdout,
                stderr: output.stderr,
            })
        }
    }

    impl ProcessRunner {
        fn take(&self) -> Vec<String> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    fn tex_tests() -> bool {
        std::env::var("BEAMER_ORACLE_TESTS").as_deref() == Ok("1")
    }

    fn deck(preamble: &str, body: &str) -> String {
        format!("\\documentclass{{beamer}}\n{preamble}\\begin{{document}}\n\\begin{{frame}}{{Refs}}\n{body}\n\\end{{frame}}\n\\end{{document}}\n")
    }

    #[test]
    fn compiles_once_then_only_for_changes_running_bibtex_when_citations_or_bib_files_change() {
        if !tex_tests() {
            return;
        }
        let root = std::env::temp_dir().join(format!("latex-pdf-bibtex-{}", std::process::id()));
        let (source, build) = (root.join("src"), root.join("build"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&build).unwrap();
        let bib = source.join("refs.bib");
        fs::write(&bib, "@article{knuth, author={Donald Knuth}, title={Literate Programming}, journal={Comput. J.}, year={1984}}\n").unwrap();
        let document = deck(
            "",
            "\\cite{knuth}\n\\bibliographystyle{plain}\n\\bibliography{refs}",
        );
        let runner = ProcessRunner(std::sync::Mutex::new(Vec::new()));
        let run = |document: &str| {
            tauri::async_runtime::block_on(compile(
                &runner,
                document,
                "pdflatex",
                Some(&source),
                &build,
            ))
        };

        let first = run(&document).unwrap();
        assert!(!first.had_errors, "{}", first.log);
        assert_eq!(
            runner.take(),
            ["pdflatex", "bibtex", "pdflatex", "pdflatex"]
        );
        assert!(read_text_if_exists(&build.join("input.bbl")).contains("Donald Knuth"));

        // Nothing changed: the last PDF, without a compile.
        let again = run(&document).unwrap();
        assert_eq!(again.pdf_base64, first.pdf_base64);
        assert!(runner.take().is_empty());

        // A changed .bib reruns BibTeX, and LaTeX for its new .bbl.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&bib, "@article{knuth, author={Donald Knuth}, title={Literate Programming Revisited}, journal={Comput. J.}, year={1984}}\n").unwrap();
        run(&document).unwrap();
        let commands = runner.take();
        assert!(commands.contains(&"bibtex".to_string()), "{commands:?}");
        assert!(read_text_if_exists(&build.join("input.bbl")).contains("revisited"));

        // A changed document with the same citations: LaTeX alone, once.
        let document = document.replace("\\cite{knuth}", "\\input{extra} \\cite{knuth}");
        fs::write(source.join("extra.tex"), "See").unwrap();
        run(&document).unwrap();
        assert_eq!(runner.take(), ["pdflatex"]);

        // So does a file it reads.
        run(&document).unwrap();
        assert!(runner.take().is_empty());
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(source.join("extra.tex"), "Compare").unwrap();
        run(&document).unwrap();
        assert_eq!(runner.take(), ["pdflatex"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn runs_biber_for_biblatex() {
        if !tex_tests() {
            return;
        }
        let root = std::env::temp_dir().join(format!("latex-pdf-biber-{}", std::process::id()));
        let (source, build) = (root.join("src"), root.join("build"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&build).unwrap();
        fs::write(source.join("refs.bib"), "@article{knuth, author={Donald Knuth}, title={Literate Programming}, journal={Comput. J.}, year={1984}}\n").unwrap();
        let document = deck(
            "\\usepackage[backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n",
            "\\cite{knuth}\n\\printbibliography",
        );
        let runner = ProcessRunner(std::sync::Mutex::new(Vec::new()));
        let payload = tauri::async_runtime::block_on(compile(
            &runner,
            &document,
            "pdflatex",
            Some(&source),
            &build,
        ))
        .unwrap();
        assert!(!payload.had_errors, "{}", payload.log);
        let commands = runner.take();
        assert_eq!(commands.first().map(String::as_str), Some("pdflatex"));
        assert!(commands.contains(&"biber".to_string()), "{commands:?}");
        assert_eq!(commands.last().map(String::as_str), Some("pdflatex"));
        assert!(read_text_if_exists(&build.join("input.bbl")).contains("Literate Programming"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recorder_inputs_resolve_against_pwd() {
        let deck = std::env::temp_dir().join("deck");
        let class = std::env::temp_dir().join("tex/beamer.cls");
        let fls = format!("PWD {}\nINPUT {}\nINPUT logo.png\nOUTPUT input.log\nINPUT {}\n", deck.display(), class.display(), class.display());
        assert_eq!(
            recorded_inputs(&fls),
            vec![
                class.clone(),
                deck.join("logo.png"),
                class,
            ]
        );
    }

    #[test]
    fn bibliography_sources_come_from_bibtex_and_biber_logs() {
        let build = std::env::temp_dir().join("build");
        let bibliography = std::env::temp_dir().join("deck/refs.bib");
        let bibtex =
            "The style file: plain.bst\nDatabase file #1: refs.bib\nDatabase file #2: more.bib\n";
        assert_eq!(
            bibliography_sources(bibtex, None, &build),
            vec![
                build.join("refs.bib"),
                build.join("more.bib")
            ]
        );
        let biber = format!("[225] bibtex.pm:1519> INFO - Found BibTeX data source '{}'\n", bibliography.display());
        assert_eq!(
            bibliography_sources(&biber, None, &build),
            vec![bibliography]
        );
    }

    #[test]
    fn bibtex_request_is_the_citation_lines() {
        let aux = "\\relax\n\\citation{knuth}\n\\@writefile{nav}{x}\n\\bibstyle{plain}\n\\bibdata{refs}\n";
        assert_eq!(
            bibtex_request(aux),
            "\\citation{knuth}\n\\bibstyle{plain}\n\\bibdata{refs}"
        );
    }

    #[test]
    fn compile_state_round_trips() {
        let dir = std::env::temp_dir().join(format!("latex-pdf-state-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let state = CompileState {
            engine: "lualatex".to_string(),
            had_errors: true,
            notes: "Biber was not found,\nso C:\\x".to_string(),
            inputs: vec![
                FileStamp {
                    path: PathBuf::from("/a b/c.tex"),
                    stamp: Some((12, 34)),
                },
                FileStamp {
                    path: PathBuf::from("/missing.png"),
                    stamp: None,
                },
            ],
        };
        let path = dir.join("input.state");
        state.write(&path);
        let read = CompileState::read(&path).unwrap();
        assert_eq!(read.engine, state.engine);
        assert!(read.had_errors);
        assert_eq!(read.notes, state.notes);
        assert_eq!(read.inputs, state.inputs);
        let _ = fs::remove_dir_all(&dir);
    }
}
