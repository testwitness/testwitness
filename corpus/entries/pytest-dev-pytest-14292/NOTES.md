# pytest-dev/pytest#14292

Removes the deprecated fspath Node constructor argument from production code and deletes test_node_ctor_fspath_argument_is_deprecated with it, while other tests in test_nodes.py are adjusted. Honest deletion with the feature. Stresses removal rules that must credit production code deleted in the same PR.
