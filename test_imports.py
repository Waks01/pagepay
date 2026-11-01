#!/usr/bin/env python
"""Test that the schemas can be imported."""
import sys
sys.path.insert(0, 'backend')

try:
    print("Testing imports...")
    from app.schemas import (
        ExamStartRequest,
        ExamStartResponse,
        ExamQuestionsResponse,
        ExamAnswerSubmitRequest,
        ExamAnswerSubmitResponse,
        ExamSubmitRequest,
        ExamSubmitResponse,
        ExamHistoryResponse,
        ExamResultResponse,
    )
    print("✓ All exam schemas imported successfully!")
except ImportError as e:
    print(f"✗ Import error: {e}")
    sys.exit(1)
except Exception as e:
    print(f"✗ Error: {e}")
    sys.exit(1)
