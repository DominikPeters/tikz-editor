const THEME_COMPONENTS = [
  ["theme", "usetheme"],
  ["colorTheme", "usecolortheme"],
  ["fontTheme", "usefonttheme"],
  ["innerTheme", "useinnertheme"],
  ["outerTheme", "useoutertheme"],
];

export function applyBeamerThemeVariant(source, variant = {}) {
  let transformed = source;
  const missingCommands = [];

  for (const [key, command] of THEME_COMPONENTS) {
    const value = normalizeThemeName(variant[key], key);
    if (value == null) {
      continue;
    }
    const replacement = `\\${command}{${value}}`;
    const pattern = new RegExp(
      String.raw`\\${command}(?:\s*\[[^\]]*\])?\s*\{[^{}]*\}`,
      "gu"
    );
    let replaced = false;
    transformed = transformed.replace(pattern, () => {
      if (replaced) {
        return "";
      }
      replaced = true;
      return replacement;
    });
    if (!replaced) {
      missingCommands.push(replacement);
    }
  }

  if (missingCommands.length === 0) {
    return transformed;
  }
  const documentClass = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^{}]*\}/u;
  if (!documentClass.test(transformed)) {
    throw new Error(
      "Cannot inject a Beamer theme variant without a \\documentclass command."
    );
  }
  return transformed.replace(
    documentClass,
    (match) => `${match}\n\n${missingCommands.join("\n")}`
  );
}

export function beamerThemeVariantSlug(variant = {}) {
  const parts = [];
  for (const [key] of THEME_COMPONENTS) {
    const value = normalizeThemeName(variant[key], key);
    if (value != null) {
      parts.push(`${slugify(key)}-${slugify(value)}`);
    }
  }
  return parts.join("-") || "source-theme";
}

function normalizeThemeName(value, key) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized === "" || /[{}\\\r\n]/u.test(normalized)) {
    throw new Error(`Invalid Beamer ${key} value: ${String(value)}`);
  }
  return normalized;
}

function slugify(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
