# keras-team/keras#22970

Relaxes int8 quantization error bounds from 1e-3 to 1e-2 or 2e-2 in three layer tests whose comments already call them weak correctness tests. Each assertion stays an upper bound on the same expression. Honest control for A002 on changed bound constants.
