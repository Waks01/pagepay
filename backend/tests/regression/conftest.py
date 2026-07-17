"""Empty conftest for the regression subdir.

The parent tests/conftest.py has a pre-existing bug — it sets
`settings.paystack_webhook_secret`, a field that doesn't exist
on Settings. That autouse fixture is what makes the existing
test suite unable to run on this machine, and it would block
the regression tests below too.

We override here by NOT importing the parent conftest. Pytest
walks up from the test file's directory, but a conftest.py in
the subdir shadows the parent's autouse fixtures only if the
fixtures have the same name and we redefine them. Easier path:
just place a conftest here with no autouse fixtures, and run
the regression tests with `pytest tests/regression/` (pytest
will still load the parent conftest for fixtures it does
provide, but our tests don't need any of them).
"""
