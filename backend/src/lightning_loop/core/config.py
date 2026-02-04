"""Application configuration."""
from pydantic_settings import BaseSettings
from functools import lru_cache


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
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
