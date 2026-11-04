# apache/pulsar#25716

Replaces a lower bound on overflow messages received by the low priority consumer (at least total minus twice the queue size minus one) with assertTrue(lowSeen.size() > 0). Weakened: one overflow message now passes. Stresses A002 where an equality to true on a bound expression becomes a truthiness assertion on a weaker bound.
