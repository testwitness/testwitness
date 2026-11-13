class Settings:
    def __init__(self, **values):
        self._values = dict(values)

    def __getattr__(self, name):
        if name not in self._values:
            raise AttributeError(f"no setting named {name}")
        return self._values[name]
