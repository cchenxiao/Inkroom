package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"inkloom/internal/agents"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// BuildChapterReviewInput names every segment within the assembly, preserving original IDs and commit provenance.
func BuildChapterReviewInput(a ChapterAssembly, contexts map[string]manuscript.FrozenInput) (ChapterReviewInput, error) {
	in := ChapterReviewInput{AssemblyID: a.ID, DraftVersion: a.Version, AssemblyDigest: a.Digest, Parts: []ChapterReviewPart{}}
	if a.ID == "" || a.Version < 1 || len(a.Digest) != 64 || len(a.Parts) == 0 {
		return in, ErrInvalidWrite
	}
	for i, p := range a.Parts {
		frozen, ok := contexts[p.CommitID]
		context, found := frozen.Bundle.ForBeat(p.BeatID)
		task := context.WritingTask
		if !ok || !found || task == nil || task.PlanVersion != a.PlanVersion {
			return in, ErrContextMismatch
		}
		part := ChapterReviewPart{BeatID: p.BeatID, SceneID: p.SceneID, Title: p.SceneTitle + " · " + p.BeatTitle, CommitID: p.CommitID, POV: context.POV, StoryTime: task.StoryTime, Segments: []ChapterReviewSource{}, Facts: []ChapterReviewSource{}}
		for n, s := range p.Segments {
			part.Segments = append(part.Segments, ChapterReviewSource{ID: fmt.Sprintf("s-%d-%d", i+1, n+1), Kind: "passage", Text: s.Text, SourceID: s.ID, SourceVersion: p.DraftVersion})
		}
		for n, f := range context.FactSources() {
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
		chat = authorReviewFake{next: model.NewFake([]model.Step{{Role: "chapter_consistency", Content: `{"findings":[]}`}, {Role: "chapter_language", Content: `{"findings":[]}`}})}
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
		output := cfg.MaxOutputTokens
		if rendered.Role == "chapter_consistency" && cfg.ConsistencyOutputTokens > 0 {
			output = cfg.ConsistencyOutputTokens
		}
		estimate += len(rendered.SystemPrompt) + len(rendered.UserPrompt) + output + 136
	}
	if cfg.MaxCalls < 2 || estimate > cfg.MaxTokens {
		return ChapterReviewOutput{}, fmt.Errorf("整章双路复审预估需 %d tokens 调用预算，当前上限 %d；未发起模型调用。请调整 INKLOOM_MAX_TOKENS 或拆分过长章稿", estimate, cfg.MaxTokens)
	}
	guard := model.NewGuard(chat, model.Limits{Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: onCall})
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
			if e == nil && i == 0 && in.EnhancedContinuity {
				var extra []ChapterFinding
				extra, e = reviewChapterContinuity(ctx, chat, in)
				if e == nil {
					for n := range extra {
						extra[n].ID = fmt.Sprintf("enhanced-continuity-%d", len(result.Findings)+n+1)
					}
					result.Findings = append(result.Findings, extra...)
					e = ValidateChapterFindings(in, role, result.Findings)
				}
			}
			c := ChapterCriticResult{Critic: role, Status: "completed", Findings: result.Findings}
			if e != nil {
				c.Status = "failed"
				c.Error = e.Error()
				c.Failure = DescribeChapterReviewFailure(e)
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

// Reuses the writing reviewer and restores chapter evidence from immutable sources.
func reviewChapterContinuity(ctx context.Context, chat model.ChatModel, in ChapterReviewInput) ([]ChapterFinding, error) {
	segments := []manuscript.Segment{}
	for _, p := range in.Parts {
		for _, s := range p.Segments {
			segments = append(segments, manuscript.Segment{ID: s.ID, BeatID: p.BeatID, Text: s.Text, Version: in.DraftVersion, Order: len(segments) + 1})
		}
	}
	assessment, _, err := agents.CheckNarrativeContinuity(ctx, chat, segments, in.DraftVersion, manuscript.ContextBundle{})
	if err != nil {
		return nil, err
	}
	out := []ChapterFinding{}
	for _, f := range assessment.Findings {
		evidence := []ChapterEvidence{{Ref: f.SegmentID, Quote: f.Quote}, {Ref: f.RuleRef, Quote: f.RuleQuote}}
		if f.SegmentID == f.RuleRef {
			// One source cannot pretend to be two independent chapter evidence refs.
			// Keep the within-passage concern as a human-review suggestion.
			f.Severity, f.EvidenceStatus, f.RequiresHuman = review.P3, "uncertain", true
			f.EvidenceRefs = []string{f.SegmentID}
			for _, s := range segments {
				if s.ID == f.SegmentID {
					evidence = []ChapterEvidence{{Ref: s.ID, Quote: s.Text}}
					break
				}
			}
		}
		out = append(out, ChapterFinding{Finding: f, Evidence: evidence})
	}
	return out, nil
}
