Positive, Mockito. verify(ledger, times(1)) becomes verify(ledger, atLeastOnce()). The verification mode drops from exact count (4) to a lower bound (2), so high.
