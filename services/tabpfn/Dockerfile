FROM python:3.11-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
# TabPFN downloads model weights on first use; mount a volume at /root/.cache to persist them.
# (Weights require accepting the Prior Labs license and an API/HF token — see README.)
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
