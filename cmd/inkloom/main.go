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
	"syscall"
	"time"

	"inkloom/internal/agents/parse"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/orchestration"
	"inkloom/internal/server"
)

func main() {
	knowledgeSeed := flag.Bool("knowledge-seed", false, "explicitly publish teaching knowledge snapshot to database")
	knowledgeImport := flag.String("knowledge-import", "", "publish author-confirmed knowledge JSON with expectedVersion and reason")
	knowledgeShow := flag.Bool("knowledge-show", false, "read current ch7/main author knowledge snapshot from database")
	knowledgeVersion := flag.Int("knowledge-version", 0, "knowledge-show snapshot version; 0 means current head")
	knowledge := flag.Bool("knowledge-preview", false, "preview typed timeline, knowledge and foreshadows; offline teaching snapshot")
	chapter := flag.Int("chapter", 7, "knowledge-preview narrative chapter")
	storyTime := flag.Int64("story-time", 420, "knowledge-preview story time in project minutes")
	candidateCritic := flag.Bool("critic-eval-candidate", false, "use experimental consistency prompt v3 for -critic-eval only")
	evalCritic := flag.Bool("critic-eval", false, "evaluate 5 fixed critic evidence cases; uses configured chat model, no database or embeddings")
	evalMemory := flag.Bool("memory-eval", false, "evaluate Recall@1 on the explicitly seeded teaching corpus")
	seedMemory := flag.Bool("memory-seed", false, "explicitly import teaching memory records into configured database")
	memoryQuery := flag.String("memory-search", "", "search confirmed database memory; returns pinned retrieval context")
	memoryImport := flag.String("memory-import", "", "publish one frozen commit segment with author-provided visibility metadata from JSON")
	preview := flag.Bool("context-preview", false, "preview material visibility with teaching records; no model or database calls")
	pov := flag.String("pov", "character-shenyan", "preview POV: character-shenyan or character-luqing")
	scenario := flag.String("scenario", "normal", "offline scenario (see -list-scenarios)")
	list := flag.Bool("list-scenarios", false, "list offline scenarios")
	serve := flag.Bool("serve", false, "serve the local PostgreSQL-backed HTTP API")
	maxRounds := flag.Int("max-rounds", 2, "maximum revision rounds: 2 or 3")
	localRewrite := flag.Bool("allow-local-rewrite", false, "authorize current scene/beat candidate rewriting, preserving locked facts and event outcome")
	autoRevise := flag.Bool("auto-revise", true, "authorize P2 edits to the isolated candidate")
	flag.Parse()
	invalidKnowledgeOption := false
	invalidKnowledgeVersion := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "knowledge-version" && !*knowledgeShow {
			invalidKnowledgeVersion = true
		}
		if (f.Name == "chapter" || f.Name == "story-time") && !*knowledge {
			invalidKnowledgeOption = true
		}
	})
	if invalidKnowledgeVersion || *knowledgeVersion < 0 {
		fmt.Fprintln(os.Stderr, "-knowledge-version requires -knowledge-show and a nonnegative version")
		os.Exit(1)
	}
	if invalidKnowledgeOption {
		fmt.Fprintln(os.Stderr, "-chapter and -story-time require -knowledge-preview")
		os.Exit(1)
	}
	if *candidateCritic && !*evalCritic {
		fmt.Fprintln(os.Stderr, "-critic-eval-candidate requires -critic-eval")
		os.Exit(1)
	}
	modes := 0
	for _, enabled := range []bool{*knowledgeSeed, *knowledgeShow, *knowledgeImport != "", *knowledge, *evalCritic, *preview, *serve, *list, *seedMemory, *evalMemory, *memoryQuery != "", *memoryImport != ""} {
		if enabled {
			modes++
		}
	}
	if modes > 1 {
		fmt.Fprintln(os.Stderr, "choose only one command mode")
		os.Exit(1)
	}
	if *knowledge {
		if err := knowledgePreview(os.Stdout, *pov, *chapter, *storyTime); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if *preview {
		if *serve || *list {
			fmt.Fprintln(os.Stderr, "-context-preview cannot be combined with -serve or -list-scenarios")
			os.Exit(1)
		}
		if err := contextPreview(os.Stdout, *pov); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if *list {
		for _, name := range demo.Scenarios {
			fmt.Println(name)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var err error
	if *knowledgeSeed || *knowledgeShow || *knowledgeImport != "" {
		err = knowledgeCommand(ctx, *knowledgeSeed, *knowledgeImport, *knowledgeVersion)
	} else if *evalCritic {
		err = criticEvaluation(ctx, *candidateCritic)
	} else if *seedMemory || *evalMemory || *memoryQuery != "" || *memoryImport != "" {
		err = memoryCommand(ctx, *seedMemory, *evalMemory, *memoryImport, *memoryQuery, *pov)
	} else if *serve {
		err = server.Serve(ctx)
	} else {
		err = run(ctx, *scenario, orchestration.Options{AllowLocalRewrite: *localRewrite, MaxRounds: *maxRounds, AutoRevise: *autoRevise})
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

func run(ctx context.Context, scenario string, opts orchestration.Options) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	slog.InfoContext(ctx, "run.started", "model", cfg.Model, "scenario", scenario)
	result, err := app.ExecuteChapter(ctx, cfg, scenario, opts)
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
