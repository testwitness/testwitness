# aio-libs/aiohttp#10577

Folds two leak tests that each ran an isolated script in a subprocess into one test parametrised over the script name. The subprocess call and its assertion on the return code stay. Honest parametrised fold.
