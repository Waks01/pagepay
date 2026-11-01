"""Content slicing: split long-form books and articles into 1-minute reads."""
from app.services.content.slicing.slicer import (
    Slice,
    slice_work,
    slice_and_persist,
    slice_all_books,
    force_reslice_all,
)

__all__ = [
    "Slice",
    "slice_work",
    "slice_and_persist",
    "slice_all_books",
    "force_reslice_all",
]


# OpenAPI-facing dependency: schema module is exposed for FastAPI's response_model.
# Imported lazily by the routers when needed.