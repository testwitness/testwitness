# huggingface/diffusers#13454

Adds pytest.mark.xfail(condition on transformers version, strict=False, reason with an issue link) to three existing download tests. Non strict, so the tests can pass or fail silently. Weakened. Stresses R004 strictness detection.
