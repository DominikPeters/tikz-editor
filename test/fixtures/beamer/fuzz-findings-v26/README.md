# Hosted label transfer and covered ownership

A containing block clones its render context: label maps and their change state
must remain shared, or preparation stops before rebuilding the child minipage.
Whole-container visibility covers transferred labels even when their source owner
lies outside that paragraph. Their hidden layout remains strictly compared.

This reduction also exposed an initial parent-list skip that escaped minipage
suppression, and an ignored final structural box/terminal skip in block-body
measurement. Nested background paint retains the enclosing Beamer color context.
