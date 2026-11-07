# Pending labels after structural blocks

Six simple block/column controls passed while the original first column from
newer case 0003 still failed. Its pending last label lacked the interline glue
after the block's smallskip. That skip preserves the previous physical depth;
it does not cancel the pending paragraph's interline state.

All seven cases and twenty-two overlay states pass strict live checks in
`artifacts/beamer-fuzz/v35-interline`. Both the failing complex reduction and the
initially passing controls are retained. The complete newer saved campaign now
passes 39/39 frames and 81 states; full live campaign verification is outstanding.
