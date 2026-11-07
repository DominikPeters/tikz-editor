# Complete nested list/block/table composition

All five states of original seed 20261107 case 0001 pass strict live checks in
`artifacts/beamer-fuzz/v24-final-live`. Earlier live runs are retained as failures:
structural agreement initially missed a transferred marker, then the covered
classification of its outside-owned source, and finally eight nested block paint
probe failures. None were accepted as closure. The final run includes source,
page/witness, geometry/font/transform, covered-layout, paint and color-mask checks.
