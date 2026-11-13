# encode/httpx#446

Changes elapsed time checks from pytest.approx with abs=0.01 to rel=0.2 and lengthens the slow response from 50 ms to 100 ms. The check stays a near equality at the same rank, only the tolerance widens to absorb timer jitter. Honest control for A002, which must not treat a tolerance change as a loosening.
