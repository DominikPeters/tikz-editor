import type { Statement } from "../ast/types.js";
import { resolveColorToCss, resolveDefineColorModel } from "./style/colors.js";
import { nestedStatements } from "../ast/walk.js";

export function collectDeclaredColorsFromStatements(statements: readonly Statement[]): ReadonlyMap<string, string> {
  const declared = new Map<string, string>();

  const visit = (statement: Statement): void => {
    const body = nestedStatements(statement);
    if (body) {
      for (const nested of body) {
        visit(nested);
      }
      return;
    }

    if (statement.kind === "Colorlet") {
      const name = normalizeDeclaredColorName(statement.nameRaw);
      if (!name) {
        return;
      }
      const css = resolveColorToCss(statement.valueRaw, {
        resolveAlias: (rawName) => declared.get(rawName.trim().toLowerCase()) ?? null
      });
      if (css != null) {
        declared.set(name, css);
      }
      return;
    }

    if (statement.kind === "DefineColor") {
      const name = normalizeDeclaredColorName(statement.nameRaw);
      if (!name) {
        return;
      }
      const css = resolveDefineColorModel(statement.modelRaw.trim(), statement.specificationRaw.trim());
      if (css != null) {
        declared.set(name, css.toLowerCase());
      }
    }
  };

  for (const statement of statements) {
    visit(statement);
  }
  return declared;
}

function normalizeDeclaredColorName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
