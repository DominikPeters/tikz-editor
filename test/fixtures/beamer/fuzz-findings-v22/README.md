# Table baseline and inherited list-context regressions

Table row struts use the active font's baseline register, including implicit
list body fonts and explicit fontsize/baseline selections. A paragraph's initial
baseline enters inline font state, so later declarations still take effect at
their actual source position.

Nested blocks additionally exercise transferred labels that share local depth
and ordinal with a minipage's own list. Command ownership distinguishes them;
relative ancestor margins survive transfer. List dimensions/label separation
retain their class-assigned font basis, while marker templates retain the true
itemize/enumerate font depth across descriptions and minipages. Tiny markers use
the class's tiny font size/face; sphere shading uses the class's normal size.
Pending parent label contexts also participate in structural entry spacing.
