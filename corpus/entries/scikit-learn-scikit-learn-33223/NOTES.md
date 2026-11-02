# scikit-learn/scikit-learn#33223

Repeated pos_label checks across display curve tests are extracted into a _check_pos_label_statistics helper, and _check_auc is nested with an extra parameter. Assertions move from test bodies into the helper. Honest extraction. Stresses custom assertion detection (helper defined in the same file whose body asserts).
