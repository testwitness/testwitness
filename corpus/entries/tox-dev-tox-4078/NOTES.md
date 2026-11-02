# tox-dev/tox#4078

Adds pytest.mark.skipif(sys.platform == 'win32', reason=...) to three tests that mock a POSIX venv layout. The condition is a real platform check and each marker carries a reason. Honest conditional skip. Stresses skip rules that must accept a conditional marker with a reason.
