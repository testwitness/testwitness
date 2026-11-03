# huggingface/diffusers#14977

Adds new test overrides in several tester classes that are decorated with module level aliases of pytest.mark.xfail(strict=True). The tests are born expected to fail. Stresses R010 when the marker is reached through an alias assigned at module level.
