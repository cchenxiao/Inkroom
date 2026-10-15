package main

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/storage/postgres"
	"io"
	"os"
	"time"
)

func memoryCommand(ctx context.Context, seed, eval bool, importPath, query, pov string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("INKLOOM_DATABASE_URL required")
	}
	ctx, stop := context.WithTimeout(ctx, 90*time.Second)
	defer stop()
	store, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	if seed {
		records, e := demo.MemorySeed()
		if e != nil {
			return e
		}
		if e = store.SeedMemory(ctx, records); e != nil {
			return e
		}
		fmt.Println("已导入明确标记的教学材料；未确认记录未入库，不代表正式故事事实。")
		return nil
	}
	if importPath != "" {
		file, e := os.Open(importPath)
		if e != nil {
			return e
		}
		defer file.Close()
		var publication postgres.MemoryPublication
		decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
		decoder.DisallowUnknownFields()
		if e = decoder.Decode(&publication); e != nil {
			return fmt.Errorf("invalid publication JSON")
		}
		if decoder.Decode(new(any)) != io.EOF {
			return fmt.Errorf("expected one publication object")
		}
		if e = store.PublishMemory(ctx, publication); e != nil {
			return e
		}
		fmt.Println("已发布冻结正文的前情索引；正文仍是 passage，未升级为世界事实。")
		return nil
	}
	view := app.CurrentMemoryView()
	if pov != "character-shenyan" && pov != "character-luqing" {
		return fmt.Errorf("unsupported teaching POV")
	}
	view.POV = pov
	searcher, err := app.NewRetrieval(cfg, store)
	if err != nil {
		return err
	}
	if eval {
		type sample struct {
			Query    string `json:"query"`
			Expected string `json:"expected"`
			First    string `json:"first"`
			Hit      bool   `json:"hit"`
		}
		report := struct {
			Mode          string   `json:"mode"`
			RecallAt1     float64  `json:"recallAt1"`
			ForbiddenHits int      `json:"forbiddenHits"`
			Note          string   `json:"note"`
			Samples       []sample `json:"samples"`
		}{Note: "3 条教学样本，不代表全书检索质量；假向量结果不能说明语义能力", Samples: []sample{}}
		for _, c := range demo.RetrievalCases {
			result, e := searcher.Search(ctx, view, c.Query, 3)
			if e != nil {
				return e
			}
			report.Mode = result.Context.Mode
			first := ""
			if len(result.Context.Hits) > 0 {
				first = result.Context.Hits[0].Record.ID
			}
			hit := first == c.ExpectedID
			if hit {
				report.RecallAt1++
			}
			report.Samples = append(report.Samples, sample{c.Query, c.ExpectedID, first, hit})
			for _, h := range result.Context.Hits {
				if h.Record.ID == "seed-hidden-letter" && view.POV == "character-shenyan" {
					report.ForbiddenHits++
				}
			}
		}
		report.RecallAt1 /= float64(len(demo.RetrievalCases))
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(report)
	}
	result, err := searcher.Search(ctx, view, query, 3)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
