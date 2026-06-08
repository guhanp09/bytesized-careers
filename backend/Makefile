.PHONY: dev test lint format migrate revision downgrade docker-up docker-down

dev:
	uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test:
	uv run pytest

lint:
	uv run ruff check .

format:
	uv run ruff format .

migrate:
	uv run alembic upgrade head

revision:
	uv run alembic revision --autogenerate -m "new_migration"

downgrade:
	uv run alembic downgrade -1

docker-up:
	docker compose up --build

docker-down:
	docker compose down
