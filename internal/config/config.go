package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Embedder            string
	EmbeddingKey        string
	EmbeddingDimensions int
	EmbeddingRevision   string
	ContextTokens       int
	DatabaseURL         string
	Model               string
	APIKey              string
	ModelName           string
	BaseURL             string
	CallTimeout         time.Duration
	MaxCalls            int
	MaxTokens           int
	MaxOutputTokens     int
}

func Load() (Config, error) {
	if err := godotenv.Load(".env.backend.local"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, fmt.Errorf("cannot read .env.backend.local")
	}
	name := os.Getenv("INKLOOM_MODEL")
	if name == "" {
		name = "fake"
	}
	if name != "fake" && name != "deepseek" {
		return Config{}, fmt.Errorf("INKLOOM_MODEL must be fake or deepseek")
	}
	cfg := Config{DatabaseURL: os.Getenv("INKLOOM_DATABASE_URL"), Model: name, APIKey: os.Getenv("DEEPSEEK_API_KEY"), ModelName: env("DEEPSEEK_MODEL", "deepseek-flash"), BaseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), CallTimeout: 60 * time.Second}
	if name == "deepseek" && cfg.APIKey == "" {
		return Config{}, fmt.Errorf("DEEPSEEK_API_KEY is required")
	}
	if name == "fake" {
		cfg.ModelName = "scripted-fake"
	}
	cfg.Embedder = env("INKLOOM_EMBEDDER", "none")
	cfg.EmbeddingKey = os.Getenv("ZHIPU_API_KEY")
	cfg.EmbeddingRevision = env("INKLOOM_EMBEDDING_REVISION", "v1")
	if cfg.Embedder != "none" && cfg.Embedder != "fake" && cfg.Embedder != "zhipu" {
		return Config{}, fmt.Errorf("INKLOOM_EMBEDDER must be none, fake or zhipu")
	}
	if cfg.Embedder == "fake" && name != "fake" {
		return Config{}, fmt.Errorf("Fake embeddings require Fake chat")
	}
	if cfg.Embedder == "zhipu" && cfg.EmbeddingKey == "" {
		return Config{}, fmt.Errorf("ZHIPU_API_KEY is required")
	}
	var err error
	if cfg.EmbeddingDimensions, err = positive("INKLOOM_EMBEDDING_DIMENSIONS", 1024); err != nil {
		return Config{}, err
	}
	if cfg.ContextTokens, err = positive("INKLOOM_CONTEXT_TOKENS", 8000); err != nil {
		return Config{}, err
	}
	if cfg.MaxCalls, err = positive("INKLOOM_MAX_CALLS", 14); err != nil {
		return Config{}, err
	}
	if cfg.MaxTokens, err = positive("INKLOOM_MAX_TOKENS", 24000); err != nil {
		return Config{}, err
	}
	if cfg.MaxOutputTokens, err = positive("INKLOOM_MAX_OUTPUT_TOKENS", 2048); err != nil {
		return Config{}, err
	}
	if raw := os.Getenv("INKLOOM_CALL_TIMEOUT"); raw != "" {
		cfg.CallTimeout, err = time.ParseDuration(raw)
		if err != nil || cfg.CallTimeout <= 0 {
			return Config{}, fmt.Errorf("INKLOOM_CALL_TIMEOUT must be a positive duration")
		}
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func positive(key string, fallback int) (int, error) {
	if raw := os.Getenv(key); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			return 0, fmt.Errorf("%s must be a positive integer", key)
		}
		return n, nil
	}
	return fallback, nil
}
