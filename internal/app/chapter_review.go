package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
)

// BuildChapterReviewInput names every segment within the assembly, preserving original IDs and commit provenance.
func BuildChapterReviewInput(a ChapterAssembly, contexts map[string]manuscript.FrozenInput) (ChapterReviewInput, error) {
	in := ChapterReviewInput{AssemblyID: a.ID, DraftVersion: a.Version, AssemblyDigest: a.Digest, Parts: []ChapterReviewPart{}}
	if a.ID == "" || a.Version < 1 || len(a.Digest) != 64 || len(a.Parts) == 0 {
		return in, ErrInvalidWrite
	}
	for i, p := range a.Parts {
		frozen, ok := contexts[p.CommitID]
		task := frozen.Bundle.WritingTask
		if !ok || task == nil || frozen.Bundle.Beat.ID != p.BeatID || task.PlanVersion != a.PlanVersion {
			return in, ErrContextMismatch
		}
		part := ChapterReviewPart{BeatID: p.BeatID, SceneID: p.SceneID, Title: p.SceneTitle + " · " + p.BeatTitle, CommitID: p.CommitID, POV: frozen.Bundle.POV, StoryTime: task.StoryTime, Segments: []ChapterReviewSource{}, Facts: []ChapterReviewSource{}}
		for n, s := range p.Segments {
			part.Segments = append(part.Segments, ChapterReviewSource{ID: fmt.Sprintf("s-%d-%d", i+1, n+1), Kind: "passage", Text: s.Text, SourceID: s.ID, SourceVersion: p.DraftVersion})
		}
		for n, f := range frozen.Bundle.FactSources() {
			part.Facts = append(part.Facts, ChapterReviewSource{ID: fmt.Sprintf("f-%d-%d", i+1, n+1), Kind: "fact", Text: f.Text, SourceID: f.ID, SourceVersion: f.Version})
		}
		in.Parts = append(in.Parts, part)
	}
	return in, in.Validate()
}
func (in ChapterReviewInput) Validate() error {
	if in.AssemblyID == "" || in.DraftVersion < 1 || len(in.AssemblyDigest) != 64 || len(in.Parts) == 0 || len(in.Parts) > 8 {
		return ErrInvalidWrite
	}
	ids := map[string]bool{}
	beats := map[string]bool{}
	for _, p := range in.Parts {
		if p.CommitID == "" || p.BeatID == "" || beats[p.BeatID] || len(p.Segments) == 0 {
			return ErrInvalidWrite
		}
		beats[p.BeatID] = true
		for _, list := range []struct {
			kind    string
			sources []ChapterReviewSource
		}{{"passage", p.Segments}, {"fact", p.Facts}} {
			for _, s := range list.sources {
				if s.ID == "" || ids[s.ID] || s.Kind != list.kind || s.SourceVersion < 1 || s.SourceID == "" || strings.TrimSpace(s.Text) == "" {
					return ErrInvalidWrite
				}
				ids[s.ID] = true
			}
		}
	}
	return nil
}

// ReviewChapter is a read-only fan-out/barrier. Each slot owns its output; no reviewer sees its peer's findings.
func ReviewChapter(ctx context.Context, cfg config.Config, in ChapterReviewInput, onCall func(context.Context, model.CallRecord) error) (ChapterReviewOutput, error) {
	if err := in.Validate(); err != nil {
		return ChapterReviewOutput{}, err
	}
	var chat model.ChatModel
	var err error
	if cfg.Model == "fake" {
		chat = model.NewFake([]model.Step{{Role: "chapter_consistency", Content: `{"findings":[]}`}, {Role: "chapter_language", Content: `{"findings":[]}`}})
	} else {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return ChapterReviewOutput{}, err
		}
	}
	// Reserve both independent reviews before either is sent. Never silently omit text or spend on only half a chapter review.
	estimate := 0
	for i := 0; i < 2; i++ {
		input, e := chapterReviewModelInput(in, i)
		if e != nil {
			return ChapterReviewOutput{}, e
		}
		rendered, e := prompts.Render(input)
		if e != nil {
			return ChapterReviewOutput{}, e
		}
		estimate += len(rendered.SystemPrompt) + len(rendered.UserPrompt) + cfg.MaxOutputTokens + 136
	}
	if cfg.MaxCalls < 2 || estimate > cfg.MaxTokens {
		return ChapterReviewOutput{}, fmt.Errorf("整章双路复审预估需 %d tokens 调用预算，当前上限 %d；未发起模型调用。请调整 INKLOOM_MAX_TOKENS 或拆分过长章稿", estimate, cfg.MaxTokens)
	}
	guard := model.NewGuard(chat, model.Limits{Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: onCall})
	return reviewChapterWith(ctx, prompts.Bind(guard), in)
}
func reviewChapterWith(ctx context.Context, chat model.ChatModel, in ChapterReviewInput) (ChapterReviewOutput, error) {
	roles := []string{"hard_consistency", "ai_taste"}
	out := ChapterReviewOutput{Critics: make([]ChapterCriticResult, 2)}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, role := range roles {
		wg.Add(1)
		go func(i int, role string) {
			defer wg.Done()
			input, e := chapterReviewModelInput(in, i)
			if e != nil {
				errs[i] = e
				out.Critics[i] = ChapterCriticResult{Critic: role, Status: "failed", Error: e.Error(), Findings: []ChapterFinding{}}
				return
			}
			result, _, e := parse.Generate[struct {
				Findings []ChapterFinding `json:"findings"`
			}](ctx, chat, input, func(x struct {
				Findings []ChapterFinding `json:"findings"`
			}) error {
				return ValidateChapterFindings(in, role, x.Findings)
			})
			c := ChapterCriticResult{Critic: role, Status: "completed", Findings: result.Findings}
			if e != nil {
				c.Status = "failed"
				c.Error = e.Error()
				c.Findings = []ChapterFinding{}
			}
			out.Critics[i] = c
			errs[i] = e
		}(i, role)
	}
	wg.Wait()
	return out, errors.Join(errs...)
}

func chapterReviewModelInput(in ChapterReviewInput, i int) (model.Input, error) {
	material := in
	if i == 1 {
		material.Parts = append([]ChapterReviewPart{}, in.Parts...)
		for n := range material.Parts {
			material.Parts[n].Facts = []ChapterReviewSource{}
			material.Parts[n].POV = ""
		}
	}
	raw, err := json.Marshal(material)
	roles := []string{"chapter_consistency", "chapter_language"}
	return model.Input{Role: roles[i], Task: "只审本次冻结的完整章稿；保留段落顺序，返回可核对的审稿意见。", Material: raw, OutputSchema: contracts.ChapterReviewSchema}, err
}
