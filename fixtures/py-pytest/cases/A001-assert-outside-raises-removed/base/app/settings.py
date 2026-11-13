class Settings:
    def __init__(self, **values):
        self._values = dict(values)

    def __getattr__(self, name):
        try:
            return self._values[name]
        except KeyError:
            raise AttributeError(name)
