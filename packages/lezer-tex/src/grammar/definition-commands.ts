import type { Stack } from "@lezer/lr";
import { CommandDefinitionCmd, EnvironmentDefinitionCmd } from "./tex-parser.terms.js";

const ENVIRONMENT_DEFINITIONS = new Set(["\\newenvironment", "\\renewenvironment"]);
const COMMAND_DEFINITIONS = new Set(["\\newcommand", "\\renewcommand", "\\providecommand"]);

export function definitionCommand(word: string, stack: Stack): number {
  if (ENVIRONMENT_DEFINITIONS.has(word) && stack.canShift(EnvironmentDefinitionCmd)) return EnvironmentDefinitionCmd;
  if (COMMAND_DEFINITIONS.has(word) && stack.canShift(CommandDefinitionCmd)) return CommandDefinitionCmd;
  return -1;
}
