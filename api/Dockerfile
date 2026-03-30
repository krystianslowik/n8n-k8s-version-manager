FROM python:3.11-slim

# Install kubectl and helm
RUN apt-get update && apt-get install -y curl && \
    curl -LO https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl && \
    chmod +x kubectl && mv kubectl /usr/local/bin/ && \
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Generate protobuf Python code from proto definitions
COPY proto/ /proto/
COPY api/generated/__init__.py ./generated/__init__.py
RUN mkdir -p generated/n8n_manager/v1 && \
    touch generated/n8n_manager/__init__.py && \
    touch generated/n8n_manager/v1/__init__.py && \
    python -m grpc_tools.protoc \
        -I/proto \
        --python_out=./generated \
        --grpc_python_out=./generated \
        /proto/n8n_manager/v1/*.proto

# Copy application code
COPY api/*.py ./
COPY api/services/ ./services/

# Copy entrypoint script
COPY api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set KUBECONFIG to use the modified config created by entrypoint
ENV KUBECONFIG=/tmp/kubeconfig

EXPOSE 50051

ENTRYPOINT ["/entrypoint.sh"]
