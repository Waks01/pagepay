FROM python:3.11
# Tesseract locates prose on scanned pages so the figures on them can be
# separated from the text around them. It is never used to read the
# material — the vision model does that. Optional at runtime: without it
# a scanned page is kept as one whole figure, which loses nothing.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng && \
    rm -rf /var/lib/apt/lists/*
RUN useradd --create-home appuser
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --upgrade pip setuptools wheel && \
    pip install --retries 10 -r requirements.txt -r requirements-dev.txt
COPY . .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1
USER appuser
CMD ["gunicorn", "app.main:app", "-w", "2", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--keep-alive", "5"]
