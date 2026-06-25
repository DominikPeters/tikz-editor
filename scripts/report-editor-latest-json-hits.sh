#!/bin/zsh -l
set -e
set -u
set -o pipefail

HOST="kas"
REMOTE_DIR="/www/htdocs/w008ef9a/logs"
REQUEST_PATH="/editor/latest.json"
OUT_DIR="artifacts/editor-latest-json-hits"

usage() {
  cat <<'EOF'
Usage:
  scripts/report-editor-latest-json-hits.sh [--host kas] [--remote-dir /www/htdocs/w008ef9a/logs] [--path /editor/latest.json] [--out-dir artifacts/editor-latest-json-hits]

Fetches tikz.dev access-log counts over SSH and writes a timestamped report.
Outputs:
  report.md
  report.json
  ip-counts.tsv
EOF
}

remote_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"
      shift 2
      ;;
    --path)
      REQUEST_PATH="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$HOST" || -z "$REMOTE_DIR" || -z "$REQUEST_PATH" || -z "$OUT_DIR" ]]; then
  printf 'Arguments must not be empty.\n' >&2
  exit 1
fi

if [[ "$REQUEST_PATH" != /* ]]; then
  printf 'Request path must start with "/": %s\n' "$REQUEST_PATH" >&2
  exit 1
fi

timestamp="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"
run_dir="${OUT_DIR%/}/${timestamp}"
counts_path="$run_dir/ip-counts.tsv"
md_path="$run_dir/report.md"
json_path="$run_dir/report.json"

mkdir -p "$run_dir"

printf 'Local: connecting to %s\n' "$HOST" >&2
printf 'Local: remote logs: %s\n' "$REMOTE_DIR" >&2
printf 'Local: request path: %s\n' "$REQUEST_PATH" >&2

remote_dir_quoted="$(remote_quote "$REMOTE_DIR")"
request_path_quoted="$(remote_quote "$REQUEST_PATH")"
remote_command="set -e; remote_dir=$remote_dir_quoted; request_path=$request_path_quoted; printf 'Remote: checking log directory %s\n' \"\$remote_dir\" >&2; if [ ! -d \"\$remote_dir\" ]; then printf 'Remote: log directory not found: %s\n' \"\$remote_dir\" >&2; exit 2; fi; file_count=\$(find \"\$remote_dir\" -maxdepth 1 -type f -name 'access_log_tikz_dev_*.gz' | wc -l | awk '{ print \$1 }'); printf 'Remote: found %s compressed tikz.dev access logs\n' \"\$file_count\" >&2; if [ \"\$file_count\" = \"0\" ]; then exit 0; fi; printf 'Remote: scanning logs for %s\n' \"\$request_path\" >&2; zgrep -h -F \"\$request_path\" \"\$remote_dir\"/access_log_tikz_dev_*.gz 2>/dev/null | awk -v path=\"\$request_path\" '(\$6 == \"\\\"GET\" || \$6 == \"\\\"HEAD\") && \$7 == path && \$8 ~ /^HTTP\\// { counts[\$1]++ } END { for (ip in counts) print ip \"\t\" counts[ip] }' | sort -k2,2nr -k1,1; printf 'Remote: scan complete\n' >&2"

ssh_attempt=1
until ssh -n -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$HOST" "$remote_command" > "$counts_path"; do
  if (( ssh_attempt >= 3 )); then
    printf 'Local: ssh failed after %d attempts\n' "$ssh_attempt" >&2
    exit 1
  fi
  ssh_attempt=$((ssh_attempt + 1))
  printf 'Local: ssh failed; retrying in 2 seconds (attempt %d/3)\n' "$ssh_attempt" >&2
  sleep 2
done

total_hits="$(awk -F '\t' '{ total += $2 } END { print total + 0 }' "$counts_path")"
unique_ips="$(awk 'END { print NR + 0 }' "$counts_path")"

printf 'Local: received %s total hits from %s unique IPs\n' "$total_hits" "$unique_ips" >&2
printf 'Local: writing report files under %s\n' "$run_dir" >&2

{
  printf '# tikz.dev /editor/latest.json hits\n\n'
  printf -- '- Generated at: %s\n' "$timestamp"
  printf -- '- Host: %s\n' "$HOST"
  printf -- '- Remote log dir: %s\n' "$REMOTE_DIR"
  printf -- '- Request path: %s\n' "$REQUEST_PATH"
  printf -- '- Total hits: %s\n' "$total_hits"
  printf -- '- Unique IPs: %s\n\n' "$unique_ips"
  printf '| IP address | Requests |\n'
  printf '| --- | ---: |\n'
  awk -F '\t' '{ printf "| %s | %s |\n", $1, $2 }' "$counts_path"
} > "$md_path"

node - "$counts_path" "$json_path" "$timestamp" "$HOST" "$REMOTE_DIR" "$REQUEST_PATH" "$total_hits" "$unique_ips" <<'NODE'
const [countsPath, jsonPath, generatedAt, host, remoteDir, requestPath, totalHits, uniqueIps] = process.argv.slice(2);
const { readFileSync, writeFileSync } = require("node:fs");

const rows = readFileSync(countsPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [ip, count] = line.split("\t");
    return { ip, count: Number(count) };
  });

writeFileSync(
  jsonPath,
  `${JSON.stringify(
    {
      generatedAt,
      host,
      remoteDir,
      requestPath,
      totalHits: Number(totalHits),
      uniqueIps: Number(uniqueIps),
      rows
    },
    null,
    2
  )}\n`,
  "utf8"
);
NODE

printf 'Local: report generation complete\n' >&2
printf '{\n'
printf '  "runDir": "%s",\n' "$run_dir"
printf '  "markdown": "%s",\n' "$md_path"
printf '  "json": "%s",\n' "$json_path"
printf '  "tsv": "%s",\n' "$counts_path"
printf '  "totalHits": %s,\n' "$total_hits"
printf '  "uniqueIps": %s\n' "$unique_ips"
printf '}\n'
