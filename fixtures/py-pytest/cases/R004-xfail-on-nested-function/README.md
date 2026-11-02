An xfail decorator lands on a function nested inside a test body. Nested functions are not collected, the outer test keeps its assertion and markers, so nothing fires.
