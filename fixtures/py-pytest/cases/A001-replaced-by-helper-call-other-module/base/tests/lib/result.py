from app.installer import Result


class TestResult(Result):
    """Wraps an install result with checks used across the functional tests."""

    def did_create(self, path):
        assert path in self.files_created, sorted(self.files_created)

    def did_not_create(self, path):
        assert path not in self.files_created, sorted(self.files_created)


def run_install(name):
    from app.installer import install

    raw = install(name)
    return TestResult(raw.files_created, raw.returncode)
