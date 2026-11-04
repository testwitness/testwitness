# huggingface/peft#1002

Adds an in body self.skipTest('LoHaConfig test is flaky') for the LoHa case of a parametrised test, with a TODO but no issue. Weakened. Stresses R003 on a runtime skip call inside the test body rather than a decorator, which the engine does not detect today.
