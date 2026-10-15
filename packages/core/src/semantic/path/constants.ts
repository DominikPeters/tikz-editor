import { requireDefined } from "../../utils/invariants.js";
import { parseLength } from "../coords/parse-length.js";

export const DEFAULT_GRID_STEP = requireDefined(parseLength("1cm", "cm"), "Expected an internal constants value");
