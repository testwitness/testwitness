# pandas-dev/pandas#55603

Nineteen files touched to move misplaced tests into the module matching what they test; no behaviour changes. Many test names disappear from one file and reappear in another. Honest move. Stresses cross file move detection at scale, including tests with conditional skip markers.
