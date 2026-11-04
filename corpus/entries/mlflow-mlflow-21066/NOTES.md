# mlflow/mlflow#21066

Replaces two exact equality asserts on span inputs with assert all(inputs.get(k) == v for ...), which passes when extra keys appear, so the inputs are no longer pinned. The outputs assertions are split by type and stay exact. Weakened on purpose to tolerate framework changes. Stresses A002 on equality loosened to a containment check written as a truthiness assert over a generator, a shape the engine does not pair today.
