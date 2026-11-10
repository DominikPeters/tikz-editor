# Pending labels after structural blocks

Six simple block/column controls passed while the original first column from
newer case 0003 still failed. Its pending last label lacked the interline glue
after the block's smallskip. That skip preserves the previous physical depth;
it does not cancel the pending paragraph's interline state.

Both the failing complex reduction and the
initially passing controls are retained.
