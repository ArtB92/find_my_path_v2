FROM python:3.12-slim
WORKDIR /tools
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY build_climbs.py .
ENTRYPOINT ["python", "-u", "build_climbs.py"]
