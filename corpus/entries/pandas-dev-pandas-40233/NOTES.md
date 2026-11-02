# pandas-dev/pandas#40233

Adds td.skip_if_no('html5lib') to html tests and to the bs4 parametrize case so they skip when the optional dependency is missing. Honest optional dependency skip. Stresses skip rules on decorator helpers that are not literally pytest.mark.skipif.
