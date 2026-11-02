# pallets/click#3715

Reorganises deprecation tests: several near duplicate functions become one parametrised test_attr_deprecated plus test_unknown_attribute_raises and test_context_protected_args_deprecated, and the parametrize tables were extended with the target values being checked. Honest fold that also adds a stronger equality assertion. Stresses test removal rules keyed on names and assertion count per body.
