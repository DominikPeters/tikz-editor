# Top-aligned frame glue compression

The longer V29 reduction crosses the available frame height by less than a point.
Two defects prevented agreement: the frame fitting calculation omitted its
natural .2cm top skip, and a nested first paragraph used the inner list's glue
capacity after an outer list's larger topsep won the addvspace boundary.
