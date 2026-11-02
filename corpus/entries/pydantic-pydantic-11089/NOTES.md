# pydantic/pydantic#11089

Replaces a fixture that used pytest.skip to drop unavailable Self implementations with a module level pytestmark parametrize over a precomputed list. A skip call disappears and a module level parametrize appears. Honest simplification. Stresses skip marker rules (a skip removed is not a weakening) and module level marker handling.
