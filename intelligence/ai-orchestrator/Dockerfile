FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml .
COPY motoros_ai motoros_ai
RUN pip install --no-cache-dir .
COPY alembic.ini .
COPY migrations migrations
USER 10001
EXPOSE 8089
HEALTHCHECK --interval=20s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8089/healthz', timeout=2)"
CMD ["uvicorn", "motoros_ai.app:app", "--host", "0.0.0.0", "--port", "8089", "--no-access-log", "--limit-concurrency", "16"]
