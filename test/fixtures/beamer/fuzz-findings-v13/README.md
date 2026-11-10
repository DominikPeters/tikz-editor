# Shrinking blocks inside items

A block prepared as an external box inside an item must receive the widened
text width selected by Beamer's shrink option. Using the original page text
width shifts its centered text and changes wrapping. Its leading center
trivlist also inherits the minipage's suppression of the initial topsep.
