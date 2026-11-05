#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
exec neural/.venv/bin/python neural/review.py
