from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Root of the backend package (the directory containing pyproject.toml).
BASE_DIR = Path(__file__).parent.parent

_ENV_FILE = BASE_DIR.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = Field(..., alias="DATABASE_URL")
    plex_base_url: str = Field(..., alias="PLEX_BASE_URL")
    plex_token: str = Field(..., alias="PLEX_TOKEN")
    anthropic_api_key: str = Field(..., alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field("claude-sonnet-4-6", alias="ANTHROPIC_MODEL")
    embedding_model: str = Field("BAAI/bge-small-en-v1.5", alias="EMBEDDING_MODEL")
    embedding_dim: int = Field(384, alias="EMBEDDING_DIM")

    port: int = Field(8080, alias="PORT")
    catalog_ttl_seconds: int = Field(60*60*24, alias="CATALOG_TTL_SECONDS")
    max_recommendations: int = Field(25, alias="MAX_RECOMMENDATIONS")
    max_loop_turns: int = Field(8, alias="MAX_LOOP_TURNS")
    max_tool_calls: int = Field(24, alias="MAX_TOOL_CALLS")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    cors_origins: str = Field("*", alias="CORS_ORIGINS")

    static_dir: str = Field("static", alias="STATIC_DIR")

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
