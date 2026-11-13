# django/django#21566

Renames tests/migrations/test_base.py to base.py because it only holds a base class, and updates eight imports. No test changes. Honest rename that stresses R002 on a test named file that held no tests.
