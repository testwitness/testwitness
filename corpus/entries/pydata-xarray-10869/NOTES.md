# pydata/xarray#10869

Adds pytestmark = pytest.mark.xfail(reason='test.opendap.org reports a 404 error') inside the TestPyDAPDatatreeIO class, so every test in the class becomes a non strict expected failure. Weakened while the remote server is down. The engine misses a class level pytestmark assignment (it reads a module level one). Stresses R004 on class level pytestmark.
