class Result:
    def __init__(self, files_created, returncode):
        self.files_created = files_created
        self.returncode = returncode


def install(name):
    root = "site-packages/" + name
    return Result({root: 1, root + "/__init__.py": 1}, 0)
