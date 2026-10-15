package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/storage/postgres"
)

func knowledgeCommand(ctx context.Context, seed bool, importPath string, version int) error {
	var publication postgres.KnowledgePublication
	if importPath != "" {
		file, err := os.Open(importPath)
		if err != nil {
			return err
		}
		defer file.Close()
		decoder := json.NewDecoder(io.LimitReader(file, (1<<20)+1))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&publication); err != nil {
			return fmt.Errorf("invalid knowledge publication JSON")
		}
		if decoder.Decode(new(any)) != io.EOF {
			return fmt.Errorf("expected one knowledge publication object")
		}
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("INKLOOM_DATABASE_URL required")
	}
	ctx, stop := context.WithTimeout(ctx, 20*time.Second)
	defer stop()
	store, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	var result postgres.StoredKnowledge
	switch {
	case seed:
		snapshot, e := demo.KnowledgeSnapshot()
		if e != nil {
			return e
		}
		result, err = store.SeedKnowledge(ctx, snapshot)
	case importPath != "":
		result, err = store.PublishKnowledge(ctx, publication)
	default:
		scope := app.CurrentMemoryView()
		result, err = store.GetKnowledge(ctx, scope.ProjectID, scope.BranchID, version)
	}
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
