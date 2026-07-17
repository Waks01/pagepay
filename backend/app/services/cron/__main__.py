"""Entrypoint for `python -m app.services.cron`.

Kept as a separate module so the package `__init__.py` can hold the
library function (`run_once`) while still being directly invokable.
"""

from app.services.cron import main

if __name__ == "__main__":
    main()
