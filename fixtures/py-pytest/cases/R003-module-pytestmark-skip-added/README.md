A module level pytestmark = pytest.mark.skip(...) is added. No test body or decorator changes, but every test in the module stops running, so all three are reported as newly skipped.
