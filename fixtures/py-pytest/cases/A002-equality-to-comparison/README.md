assert ledger.balance() == 70 becomes >= 70. Equality to a literal drops to an ordering comparison, two steps down the lattice, so it is high.
