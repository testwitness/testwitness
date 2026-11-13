class Model:
    def __class_getitem__(cls, params):
        raise TypeError("Too many arguments for Model; actual 3, expected 2")
