// expect: TS2339
import { createCoordinateWriter } from "../../../packages/core/src/edit/writer/index.js";
const writer = createCoordinateWriter("");
writer.radii({ x: 3, y: 4, frameOf: { unitless: true } });
writer.angle(1);
writer.factor(1);
writer.length(1);
writer.shiftPair(null, { x: 1, y: 1 });
writer.typedComponents("", "1", "2");
