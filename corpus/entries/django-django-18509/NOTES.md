# django/django#18509

Adds assertEmailMessageSent on PasswordResetFormTest and replaces repeated assertEqual calls on mail.outbox with it. Direct assertion count per test falls. Honest extraction. Stresses custom assertion detection for unittest style helper methods on the test class.
