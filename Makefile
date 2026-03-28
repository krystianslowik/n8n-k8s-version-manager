.PHONY: proto proto-python proto-typescript clean

proto: proto-python proto-typescript

proto-python:
	python -m grpc_tools.protoc \
		-I./proto \
		--python_out=./api/generated \
		--grpclib_python_out=./api/generated \
		./proto/n8n_manager/v1/*.proto

proto-typescript:
	cd web-ui-next && npx buf generate ../proto

clean:
	rm -rf api/generated/n8n_manager
	rm -rf web-ui-next/lib/generated/n8n_manager
