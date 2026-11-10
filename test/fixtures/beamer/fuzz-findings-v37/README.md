# Terminal glue in nested rounded block bodies

Reduced from older case 0003. Boadilla uses the rounded inner theme: ordinary
block environments therefore end minipages. The outer body must remove the
terminal inner block's smallskip once, while retaining skips between body items.
The single-block negative control initially passed; nested blocks and the
original column failed.

These corrections make every older saved
frame pass.
