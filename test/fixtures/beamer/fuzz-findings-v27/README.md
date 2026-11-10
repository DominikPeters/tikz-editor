# Deferred block background color scopes

Rose/Boadilla and Orchid/Madrid are checked with
nested normal, alerted and example blocks, including color declarations after
theme selection. A nested fill blends against the enclosing block body's current
bg alias, rather than a permanently captured white canvas. Unrounded xcolor
channels carry between scopes. These paint failures were invisible to the
structural trace and remain covered by the unchanged live RGB tolerance of 2.
