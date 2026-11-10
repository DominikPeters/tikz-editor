# New parent item after a deeper child list

Remembering only the last paragraph's innermost list lost the preceding parent
item when another child list began a new parent item. The boundary must combine
closing skips with the new parent's itemsep, rather than treating the two child
lists as adjacent independent lists. Normal and cramped variants expose different
wrong boundaries. Deferred ancestor labels retain parent item identity; new
@noparlist flags are installed after closing the preceding child scope.
