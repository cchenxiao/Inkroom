package app

import (
	"fmt"
	"inkloom/internal/config"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"strings"
)

const ChapterBeatID = "__chapter__"

// Build every target through the same POV/time projection used for single-beat writing.
func PrepareChapterWriting(cfg config.Config, scope, runID string, base int, p planning.ChapterPlanSelection, k knowledge.Snapshot) (manuscript.FrozenInput, error) {
	targets := []manuscript.ContextBundle{}
	for _, scene := range p.Content.Scenes {
		for _, beat := range scene.Beats {
			in, err := PreparePlannedContext(cfg, scope, runID, base, p, beat.ID)
			if err != nil {
				return in, err
			}
			in, err = FreezePublishedKnowledge(in, k)
			if err != nil {
				return in, err
			}
			targets = append(targets, in.Bundle)
		}
	}
	if len(targets) == 0 || len(targets) > 8 {
		return manuscript.FrozenInput{}, fmt.Errorf("整章生成支持 1–8 个情节段")
	}
	b := targets[0]
	b.ChapterID = PlannedDraftID(scope, p.ChapterID, ChapterBeatID)
	b.Targets = targets
	in := manuscript.FrozenInput{Bundle: b, Manifest: manuscript.ContextManifest{RunID: runID, BaseDraftVersion: base, Budget: cfg.ContextTokens, ReservedOutputTokens: cfg.MaxOutputTokens}}
	if in.Manifest.Budget == 0 {
		in.Manifest.Budget = 32768
	}
	if in.Manifest.ReservedOutputTokens == 0 {
		in.Manifest.ReservedOutputTokens = 8192
	}
	return ReassemblePlanned(in)
}

// Rechecking an entire chapter must preserve exactly the original planned scope.
func ValidateChapterRecheck(b manuscript.ContextBundle, origin Run) error {
	if origin.Planning == nil || origin.Planning.Mode != "chapter" || origin.Result == nil || len(origin.Result.Segments) != len(b.Targets) || len(b.Targets) == 0 {
		return ErrVersionMismatch
	}
	ids := map[string]bool{}
	for i, target := range b.Targets {
		s := origin.Result.Segments[i]
		if s.BeatID != target.Beat.ID || s.SceneID != target.Beat.SceneID || s.ID == "" || ids[s.ID] || strings.TrimSpace(s.Text) == "" {
			return ErrVersionMismatch
		}
		ids[s.ID] = true
	}
	return nil
}
