package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"time"

	"inkloom/internal/agents/parse"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/server"
)

func main() {
	scenario := flag.String("scenario", "normal", "offline scenario (see -list-scenarios)")
	list := flag.Bool("list-scenarios", false, "list offline scenarios")
	serve := flag.Bool("serve", false, "serve the local I3 HTTP API")
	flag.Parse()
	if *list {
		for _, name := range demo.Scenarios {
			fmt.Println(name)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var err error
	if *serve {
		err = server.Serve(ctx)
	} else {
		err = run(ctx, *scenario)
	}
	if err != nil {
		code := "run_error"
		var outputErr *parse.Error
		if errors.As(err, &outputErr) {
			code = string(outputErr.Kind)
		}
		slog.Error("run.failed", "code", code, "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, scenario string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	slog.InfoContext(ctx, "run.started", "model", cfg.Model, "scenario", scenario)
	result, err := app.ExecuteChapter(ctx, cfg, scenario)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		return err
	}
	slog.InfoContext(ctx, "run.finished", "findings", len(result.Report.Findings), "highest_severity", result.Report.HighestSeverity)
	return nil
}
