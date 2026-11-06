import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, linkSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { distillFuzzCorpus } from "./fuzz-coverage.mjs";
export const fuzzHash = value => createHash("sha256").update(value).digest("hex");
export function validateEditSequence(sequence) {
  if (!sequence || sequence.formatVersion !== 1 || typeof sequence.source !== "string" || typeof sequence.family !== "string"
    || !Number.isSafeInteger(sequence.seed) || !Array.isArray(sequence.actions) || sequence.actions.length > 20000
    || ![undefined, 1, 2].includes(sequence.probeVersion)) throw new Error("Invalid Beamer edit recipe");
  const simple = new Set(["render", "neighbors", "undo"]), fields = new Set(["text", "class-font", "aspect", "theme", "alignment", "date", "width", "rotation", "overlay", "color", "comment", "title", "scope", "bounds-width"]);
  for (const action of sequence.actions) {
    if (!action || typeof action !== "object") throw new Error("Invalid edit action");
    if (simple.has(action.kind)) continue;
    if (action.kind === "set" && fields.has(action.field) && typeof action.value === "string" && ["typing", "command", "race"].includes(action.mode) && typeof action.render === "boolean") continue;
    if (action.kind === "navigate" && Number.isSafeInteger(action.frame) && action.frame >= 0 && Number.isSafeInteger(action.step) && action.step > 0 && (action.picture === undefined || typeof action.picture === "boolean")) continue;
    if (["layer", "mask"].includes(action.kind) && typeof action.enabled === "boolean") continue;
    if (action.kind === "abort" && Number.isSafeInteger(action.afterYields) && action.afterYields > 0) continue;
    throw new Error(`Invalid edit action: ${action.kind}`);
  }
  return sequence;
}
/** Append-only content-addressed seeds; namespace observations never mix code/toolchains. */
export function openBeamerFuzzCorpus(directory, namespace) {
  const entriesDir = join(directory, "entries"), observationsDir = join(directory, "observations", namespace);
  mkdirSync(entriesDir, { recursive: true }); mkdirSync(observationsDir, { recursive: true });
  const read = path => {
    if (statSync(path).size > 16 * 1024 * 1024) throw new Error(`Oversized corpus record: ${path}`);
    return JSON.parse(readFileSync(path, "utf8"));
  };
  const entries = [];
  for (const file of readdirSync(entriesDir).sort()) {
    if (!/^[a-f0-9]{64}\.json$/u.test(file)) continue;
    const sequence = validateEditSequence(read(join(entriesDir, file))), id = fuzzHash(JSON.stringify(sequence));
    if (file !== id + ".json") throw new Error(`Corrupt corpus recipe: ${file}`);
    const observation = join(observationsDir, id);
    const records = existsSync(observation) ? readdirSync(observation).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).sort().map(name => read(join(observation, name))) : [];
    for (const data of records) if (data.id !== id || data.namespace !== namespace || !Array.isArray(data.features) || !data.features.every(value => typeof value === "string") || typeof data.status !== "string") throw new Error(`Corrupt corpus observation: ${file}`);
    entries.push({ id, sequence, size: JSON.stringify(sequence).length, features: [...new Set(records.flatMap(record => record.features))].sort(),
      status: records.find(record => record.status !== "passed")?.status ?? (records.length ? "passed" : "unmeasured"), measured: records.length > 0 });
  }
  const publish = (path, value) => {
    const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    writeFileSync(temporary, JSON.stringify(value) + "\n");
    try { linkSync(temporary, path); } catch (error) { if (error.code !== "EEXIST") throw error; }
    finally { unlinkSync(temporary); }
  };
  return {
    entries,
    active() { return distillFuzzCorpus(entries); },
    remember(sequence, observation) {
      validateEditSequence(sequence);
      const serialized = JSON.stringify(sequence), id = fuzzHash(serialized), path = join(entriesDir, id + ".json");
      // Immutable files are published atomically. Concurrent supervisors never
      // overwrite each other's observations or expose partially written seeds.
      publish(path, sequence);
      const features = [...new Set(observation.features)].sort();
      const target = join(observationsDir, id); mkdirSync(target, { recursive: true });
      const key = fuzzHash(JSON.stringify({ status: observation.status, features, failureKey: observation.failureKey ?? null, limits: observation.limits ?? null }));
      publish(join(target, key + ".json"), { ...observation, id, namespace, features });
      const records = readdirSync(target).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).map(name => read(join(target, name)));
      const item = { id, sequence, size: serialized.length, features: [...new Set(records.flatMap(record => record.features))].sort(),
        status: records.find(record => record.status !== "passed")?.status ?? "passed", measured: true };
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) entries.push(item); else entries[index] = item;
      return item;
    },
  };
}
/** Mutations preserve semantic recipe targets; every concrete input is saved before running. */
export function mutateBeamerCorpusSequence(parent, seed) {
  let state = seed >>> 0;
  const random = length => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % length; };
  const sequence = structuredClone(parent);
  sequence.seed = seed >>> 0;
  const choices = sequence.actions.map((action, index) => action.kind === "set" ? index : -1).filter(index => index >= 0);
  if (!choices.length) return null;
  const index = choices[random(choices.length)], action = sequence.actions[index];
  const values = {
    text: ["A", "Corpus exploration stretches this line considerably", "éclair", "$x_1+x^2$"],
    "class-font": ["8", "9", "10", "11", "12", "14", "17", "20"], aspect: ["43", "169"],
    theme: ["default", "Madrid", "Boadilla"], alignment: ["centering", "raggedright", "raggedleft"],
    date: ["1999", "2000", "2024", "2031"], overlay: ["1", "1-2", "2-", "2-4", "3"],
    color: ["255,0,255", "18,137,67", "0,128,255"], comment: ["", "corpus 🖉 offset", "a much longer harmless source offset"],
    title: ["A", "CorpusTitle", "LongerTitle"], scope: ["plain", "centering", "raggedleft"],
  };
  if (["width", "bounds-width"].includes(action.field)) action.value = ((1 + random(1000)) / 200).toFixed(3);
  else if (action.field === "rotation") action.value = String(random(181) - 90);
  else { const alternatives = values[action.field]?.filter(value => value !== action.value); if (!alternatives?.length) return null; action.value = alternatives[random(alternatives.length)]; }
  if (random(3) === 0) action.mode = ["typing", "command", "race"][random(3)];
  if (random(4) === 0 && sequence.actions.length < 512) sequence.actions.splice(index, 0, { kind: "neighbors" });
  // Exercise combinations outside the original template grammar, without moving probe identities.
  if (random(3) === 0) {
    const begin = sequence.source.indexOf("\\begin{frame}");
    const start = begin + "\\begin{frame}".length, end = sequence.source.indexOf("\\end{frame}", start);
    if (begin >= 0 && end > start) {
      const environment = ["center", "flushleft", "flushright"][random(3)];
      sequence.source = sequence.source.slice(0, start) + `\\begin{${environment}}` + sequence.source.slice(start, end) + `\\end{${environment}}` + sequence.source.slice(end);
    }
  }
  sequence.actions.push({ kind: "render" });
  return validateEditSequence(sequence);
}
