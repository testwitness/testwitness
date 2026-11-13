Negative. The new test catches Exception only to keep it in a variable, and asserts on that variable after the try block. The failure is checked, not swallowed. Nothing fires.
