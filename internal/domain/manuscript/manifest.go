package manuscript

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

const AssemblerVersion = "assembler.v2"

// VersionRef 同时固定版本号与内容摘要：仅有“v1”不能证明两处内容相同。
type VersionRef struct {
	Kind    string          `json:"kind"`
	ID      string          `json:"id"`
	Version int             `json:"version"`
	Digest  string          `json:"digest"`
	Payload json.RawMessage `json:"payload"`
}
type ContextSource struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Version int    `json:"version"`
	Digest  string `json:"digest"`
	Method  string `json:"method"`
	Tokens  int    `json:"tokens"`
	Excerpt string `json:"excerpt"`
}
type ExcludedSource struct {
	Title  string `json:"title"`
	Reason string `json:"reason"`
}
type ContextManifest struct {
	RunID                string           `json:"runId"`
	ProjectID            string           `json:"projectId"`
	ChapterID            string           `json:"chapterId"`
	BranchID             string           `json:"branchId"`
	BaseDraftVersion     int              `json:"baseDraftVersion"`
	AssemblerVersion     string           `json:"assemblerVersion"`
	Digest               string           `json:"digest"`
	TokenEstimate        int              `json:"tokenEstimate"`
	Budget               int              `json:"budget"`
	ReservedOutputTokens int              `json:"reservedOutputTokens"`
	Sources              []ContextSource  `json:"sources"`
	Excluded             []ExcludedSource `json:"excluded"`
}
type FrozenInput struct {
	Bundle   ContextBundle   `json:"bundle"`
	Manifest ContextManifest `json:"manifest"`
}

func ContentDigest(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}

// ContextRefs 由实际输入生成引用，不接受客户端报来的 Bible/大纲版本映射。
func ContextRefs(b ContextBundle) ([]VersionRef, error) {
	refs := []VersionRef{}
	add := func(kind, id string, version int, value any) error {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		hash, err := ContentDigest(value)
		if err != nil {
			return err
		}
		refs = append(refs, VersionRef{Kind: kind, ID: id, Version: version, Digest: hash, Payload: raw})
		return nil
	}
	if err := add("outline", b.Beat.ID, b.Beat.Version, b.Beat); err != nil {
		return nil, err
	}
	for _, target := range b.Targets {
		if err := add("chapter_target", target.Beat.ID, target.Beat.Version, target); err != nil {
			return nil, err
		}
	}
	for _, passage := range b.Neighbors {
		if err := add("neighbor_passage", passage.BeatID, passage.Version, passage); err != nil {
			return nil, err
		}
	}
	if b.Rewrite != nil {
		if err := add("author_rewrite", b.Rewrite.SegmentID, b.Beat.Version, b.Rewrite); err != nil {
			return nil, err
		}
	}
	if b.WritingTask != nil {
		if err := add("writing_task", b.WritingTask.ChapterID, b.WritingTask.PlanVersion, b.WritingTask); err != nil {
			return nil, err
		}
	}
	for _, c := range b.Characters {
		if err := add("character", c.ID, c.Version, c); err != nil {
			return nil, err
		}
	}
	for _, f := range b.baseFactSources() {
		if err := add("bible_fact", f.ID, f.Version, f); err != nil {
			return nil, err
		}
	}
	for _, s := range b.Sources {
		if err := add("context_source", s.ID, s.Version, s); err != nil {
			return nil, err
		}
	}
	if b.PreviousEnding != nil {
		if err := add("previous_ending", b.PreviousEnding.ID, b.PreviousEnding.Version, *b.PreviousEnding); err != nil {
			return nil, err
		}
	}
	if b.Retrieval != nil {
		request := *b.Retrieval
		request.Hits = nil
		if err := add("retrieval_request", "inkloom-memory-query", 1, request); err != nil {
			return nil, err
		}
		for _, h := range b.Retrieval.Hits {
			if err := add("retrieved_"+string(h.Record.Kind), h.Record.ID, h.Record.Version, h); err != nil {
				return nil, err
			}
		}
	}
	policy := struct {
		POV       string   `json:"pov"`
		Banned    []string `json:"bannedPhrases"`
		Protected []string `json:"protectedTerms"`
	}{b.POV, b.BannedPhrases, b.ProtectedTerms}
	if err := add("style_policy", "inkloom-style-policy", 1, policy); err != nil {
		return nil, err
	}
	return refs, nil
}

// Validate 校验持久化输入的身份与摘要；旧 run 没有 manifest，不能在定稿时补造。
func (in FrozenInput) Validate() error {
	b, m := in.Bundle, in.Manifest
	if _, err := b.Freeze(); err != nil {
		return err
	}
	digest, err := ContentDigest(b)
	if err != nil {
		return err
	}
	if b.ProjectID == "" || (b.PreviousEnding == nil && (b.WritingTask == nil || !b.WritingTask.Opening)) || !b.Beat.Locked || (m.AssemblerVersion != AssemblerVersion && m.AssemblerVersion != "assembler.v1") || m.ProjectID != b.ProjectID || m.ChapterID != b.ChapterID || m.BranchID != b.BranchID || m.BaseDraftVersion < 0 || m.Digest != digest {
		return fmt.Errorf("invalid frozen context identity or digest")
	}
	raw, _ := json.Marshal(b)
	if m.TokenEstimate != len(raw) || m.Budget < m.TokenEstimate || m.ReservedOutputTokens < 1 {
		return fmt.Errorf("invalid context budget")
	}
	refs, err := ContextRefs(b)
	if err != nil {
		return err
	}
	if len(refs) != len(m.Sources) {
		return fmt.Errorf("context manifest sources do not match input")
	}
	for i, ref := range refs {
		source := m.Sources[i]
		if ref.ID != source.ID || ref.Kind != source.Kind || ref.Version != source.Version || ref.Digest != source.Digest || source.Method != ReferenceMethod(b, ref) || source.Tokens != len(ref.Payload) {
			return fmt.Errorf("context manifest source mismatch")
		}
	}
	return nil
}

// ReferenceMethod 由冻结结果推导，避免页面声称“搜索得到”而实际是直接配置。
func ReferenceMethod(b ContextBundle, ref VersionRef) string {
	if b.Retrieval != nil {
		for _, h := range b.Retrieval.Hits {
			if ref.Kind == "retrieved_"+string(h.Record.Kind) && ref.ID == h.Record.ID {
				return h.Method
			}
		}
	}
	return "direct"
}
