// Package contextassembly 是确定性上下文装配；不调模型、不检索最新记录。
package contextassembly

import (
	"encoding/json"
	"fmt"
	"inkloom/internal/domain/memory"

	"inkloom/internal/domain/manuscript"
)

type PreviousChapter struct {
	ProjectID string
	BranchID  string
	Confirmed bool
	Source    manuscript.SourceRef
}
type Options struct {
	RunID                string
	BaseDraftVersion     int
	Budget               int
	ReservedOutputTokens int
	Memory               *memory.RetrievalContext
	Excluded             []manuscript.ExcludedSource
}

// Assemble 当前只装必需材料。放不下就停止，不静默丢硬约束或挤掉前章结尾。
// 未确认事实不进入 bundle；excluded 只记录缺失类别/原因，不把候选正文传给 Writer。
func Assemble(b manuscript.ContextBundle, previous PreviousChapter, opts Options) (manuscript.FrozenInput, error) {
	if !previous.Confirmed || previous.ProjectID != b.ProjectID || previous.BranchID != b.BranchID {
		return manuscript.FrozenInput{}, fmt.Errorf("previous chapter must be confirmed and in the same project/branch")
	}
	b.PreviousEnding = &previous.Source
	// 可选前情按排名逐条装入，不能挤掉固定的 Beat/事实/上章结尾。
	if opts.Memory != nil {
		raw, _ := json.Marshal(opts.Memory)
		var retrieval memory.RetrievalContext
		if err := json.Unmarshal(raw, &retrieval); err != nil {
			return manuscript.FrozenInput{}, err
		}
		hits := retrieval.Hits
		retrieval.Hits = []memory.Hit{}
		b.Retrieval = &retrieval
		for _, hit := range hits {
			retrieval.Hits = append(retrieval.Hits, hit)
			trial, _ := json.Marshal(b)
			if len(trial) > opts.Budget {
				retrieval.Hits = retrieval.Hits[:len(retrieval.Hits)-1]
				opts.Excluded = append(opts.Excluded, manuscript.ExcludedSource{Title: hit.Record.ID, Reason: "相关前情超过本次材料预算，未送入模型"})
			}
		}
	}
	frozen, err := b.Freeze()
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	if !frozen.Beat.Locked {
		return manuscript.FrozenInput{}, fmt.Errorf("beat must be locked before assembly")
	}
	refs, err := manuscript.ContextRefs(frozen)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	digest, err := manuscript.ContentDigest(frozen)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	raw, _ := json.Marshal(frozen)
	if len(raw) > opts.Budget {
		return manuscript.FrozenInput{}, fmt.Errorf("required context exceeds budget: %d > %d", len(raw), opts.Budget)
	}
	m := manuscript.ContextManifest{RunID: opts.RunID, ProjectID: b.ProjectID, ChapterID: b.ChapterID, BranchID: b.BranchID, BaseDraftVersion: opts.BaseDraftVersion, AssemblerVersion: manuscript.AssemblerVersion, Digest: digest, TokenEstimate: len(raw), Budget: opts.Budget, ReservedOutputTokens: opts.ReservedOutputTokens, Sources: []manuscript.ContextSource{}, Excluded: append([]manuscript.ExcludedSource{}, opts.Excluded...)}
	for _, ref := range refs {
		title := ref.ID
		excerpt := string(ref.Payload)
		if ref.Kind == "outline" {
			title = frozen.Beat.Title
			excerpt = frozen.Beat.Description
		}
		var source manuscript.SourceRef
		if ref.Kind == "bible_fact" || ref.Kind == "context_source" || ref.Kind == "previous_ending" {
			_ = json.Unmarshal(ref.Payload, &source)
			excerpt = source.Text
		}
		if frozen.Retrieval != nil {
			for _, h := range frozen.Retrieval.Hits {
				if ref.ID == h.Record.ID && ref.Kind == "retrieved_"+string(h.Record.Kind) {
					title = h.Record.ChapterID + " / " + h.Record.SegmentID
					excerpt = h.Record.Text
					if h.Record.Knowledge != nil {
						title += fmt.Sprintf("（知识快照 v%d）", h.Record.Knowledge.Version)
					}
					if h.Origin == "teaching_seed" {
						title += "（教学种子）"
					}
				}
			}
		}
		m.Sources = append(m.Sources, manuscript.ContextSource{ID: ref.ID, Kind: ref.Kind, Title: title, Version: ref.Version, Digest: ref.Digest, Method: manuscript.ReferenceMethod(frozen, ref), Tokens: len(ref.Payload), Excerpt: excerpt})
	}
	in := manuscript.FrozenInput{Bundle: frozen, Manifest: m}
	return in, in.Validate()
}
