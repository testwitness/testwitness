# pandas-dev/pandas#60843

Turns a long Decimal ujson test with eight repeated encode and decode blocks into one parametrised test over value and precision. Honest parametrised fold. Stresses A001 on many repeated assertions collapsed into one parametrised pair.
