# scikit-learn/scikit-learn#33218

Common Display tests are moved from test_roc_curve_display.py into test_common_curve_display.py and parametrised over the Display class so other displays can share them. Names change and parametrize decorators are added. Honest move plus generalisation. Stresses move detection when the body is rewritten with a Display parameter.
