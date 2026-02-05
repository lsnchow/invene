"""Application configuration."""
from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # API
    port: int = 8811
    debug: bool = False
    
    # Backboard
    backboard_api_key: str = ""
    backboard_base_url: str = "https://app.backboard.io/api"
    backboard_model: str = "amazon/nova-micro-v1"
    backboard_provider: str = "amazon"
    
    # Memory
    memory_max_failures: int = 50
    memory_max_successes: int = 50
    
    class Config:
        # Look for .env in project root (3 levels up from this file)
        env_file = str(Path(__file__).parent.parent.parent.parent.parent / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
