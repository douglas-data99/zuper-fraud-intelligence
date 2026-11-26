"""Instância do modelo para scripts (loader, replay) sem subir a API."""
import os

from .scoring import Modelo


def modelo_padrao() -> Modelo:
    return Modelo(os.environ.get("BUNDLE_DIR", "/app/bundle"))
