from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'NETRA Backend'
    version: str = '1.0.0'
    environment: Literal['dev', 'demo', 'prod'] = 'demo'

    host: str = '0.0.0.0'
    port: int = 8000
    cors_origins: str = '*'

    planner_mode: Literal['deterministic', 'hybrid', 'vlm'] = 'hybrid'
    allow_fallback: bool = True

    vlm_enabled: bool = False
    vlm_base_url: str = 'http://localhost:11434/v1'
    vlm_api_key: str = 'local'
    vlm_model: str = 'qwen-vl'
    vlm_timeout_s: float = 45.0

    max_image_bytes: int = 8 * 1024 * 1024
    max_nodes: int = 3000
    max_instruction_chars: int = 1000
    privacy_strict: bool = True
    audit_keep: int = Field(default=500, ge=20, le=5000)


@lru_cache

def get_settings() -> Settings:
    return Settings()
