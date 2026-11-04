
Hi there,

This directory contains a Type 1 version of (some of) the
Metafont sources from the directory above. The pfb files 
are intended to be used with the original TFM files, 
_don't_ run finst or afmtotfm on the afm files! 

The afm and pfm files are provided just in case you want to
install the files on your windowing system. I'm sorry for
the Macintosh users amongst you, but I don't know how to 
create the MacType1 files.

The fonts should give exactly the same output results as 
the .mf originals, up to the point of sillyness. All bugs 
in the metafont sources have been kept (and there might be
new ones).

Files are herewith donated to the public domain, and 
provided as is. Note that I feel that the copyright 
from the metafont sources still applies, my only statement 
here is that I do not impose extra restrictions.

Conversion process:
    .mf   -> metapost (c) Hobby -> .eps
    .eps  -> metafog  (c) Kinch -> .pfb
    .pfb  -> hinted & touched up with FontLab v3.0c

More fonts should follow in the next few months. I can be reached for 
propositions/bugs at: taco.hoekwater@wkap.nl

Greetings,

Taco Hoekwater

You are welcome to use and distribute these files; if you modify them,
please change the name but give credit to the original author!
