Negative control. A toThrow matcher is rewritten as try, fail, catch where the catch body asserts on the error message. The catch does not swallow because it contains an expect, so E001 stays quiet.
