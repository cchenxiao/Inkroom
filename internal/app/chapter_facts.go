package app

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/memory"
)

type ChapterFactsInput struct {
	CharacterNames map[string]string   `json:"characterNames,omitempty"`
	ChapterID      string              `json:"chapterId"`
	Review         ChapterReviewInput  `json:"review"`
	BaseKnowledge  memory.KnowledgeRef `json:"baseKnowledge"`
	Knowledge      knowledge.Snapshot  `json:"knowledge"`
}
type ChapterFactCandidate struct {
	SuggestedKnowers []SuggestedKnower `json:"suggestedKnowers"`
	ID               string            `json:"id"`
	Text             string            `json:"text"`
	Kind             string            `json:"kind"` // event | statement | uncertain; only event may be confirmed.
	RelatedFactID    string            `json:"relatedFactId"`
	Evidence         ChapterEvidence   `json:"evidence"`
	Reason           string            `json:"reason"`
}

// Suggestions never become knowledge until included in an author's saved decision.
type SuggestedKnower struct {
	CharacterID string          `json:"characterId"`
	Evidence    ChapterEvidence `json:"evidence"`
}
type ChapterFactsOutput struct {
	Candidates []ChapterFactCandidate `json:"candidates"`
}
type ChapterFactsRequest struct {
	RequestID   string `json:"requestId"`
	ReviewID    string `json:"reviewId"`
	InputDigest string `json:"inputDigest"`
	Mode        string `json:"mode"` // model | manual
}
type ChapterFactDecision struct {
	EventBasis  string   `json:"eventBasis,omitempty"` // Explicit author correction: observed_event | speech_act. Original model kind remains in the job.
	CandidateID string   `json:"candidateId"`
	Action      string   `json:"action"` // confirm | exclude | keep_existing | revise_manuscript
	Text        string   `json:"text"`
	KnownBy     []string `json:"knownBy"` // Explicit author judgement: evidence proves knowledge at the same story time.
	Reason      string   `json:"reason"`
}
type ChapterFactsSelectionRequest struct {
	RequestID       string                 `json:"requestId"`
	JobID           string                 `json:"jobId"`
	ExpectedVersion int                    `json:"expectedVersion"`
	Decisions       []ChapterFactDecision  `json:"decisions"`
	Manual          []ChapterFactCandidate `json:"manual"`
}
type ConfirmedChapterFact struct {
	ID            string          `json:"id"`
	Text          string          `json:"text"`
	ChapterID     string          `json:"chapterId"`
	CommitID      string          `json:"commitId"`
	SegmentID     string          `json:"segmentId"`
	SourceVersion int             `json:"sourceVersion"`
	StoryTime     int64           `json:"storyTime"`
	Evidence      ChapterEvidence `json:"evidence"`
	KnownBy       []string        `json:"knownBy"`
}

// A sealed delta for the NEXT chapter, not a replacement of the current chapter's input knowledge head.
type ChapterFactPackage struct {
	BaseKnowledge memory.KnowledgeRef    `json:"baseKnowledge"`
	Facts         []ConfirmedChapterFact `json:"facts"`
}
type ChapterFactsSelection struct {
	Version   int                          `json:"version"`
	Request   ChapterFactsSelectionRequest `json:"request"`
	Package   ChapterFactPackage           `json:"package"`
	Block     string                       `json:"block"`
	CreatedAt time.Time                    `json:"createdAt"`
}
type ChapterFactsJob struct {
	ID        string              `json:"id"`
	Scope     string              `json:"scope"`
	Request   ChapterFactsRequest `json:"request"`
	Input     ChapterFactsInput   `json:"input"`
	Status    string              `json:"status"`
	Provider  string              `json:"provider"`
	Model     string              `json:"model"`
	Output    *ChapterFactsOutput `json:"output,omitempty"`
	Message   string              `json:"message"`
	Failure   *ChapterFactFailure `json:"failure,omitempty"`
	Calls     []model.CallRecord  `json:"calls"`
	CreatedAt time.Time           `json:"createdAt"`
}
type ChapterFactsState struct {
	Job       *ChapterFactsJob       `json:"job"`
	Selection *ChapterFactsSelection `json:"selection"`
	Current   bool                   `json:"current"`
	Published bool                   `json:"published"`
	Block     string                 `json:"block"`
}

func factSource(in ChapterFactsInput, e ChapterEvidence) (ChapterReviewPart, ChapterReviewSource, bool) {
	for _, p := range in.Review.Parts {
		for _, s := range p.Segments {
			if s.ID == e.Ref && strings.TrimSpace(e.Quote) != "" && strings.Contains(s.Text, e.Quote) {
				return p, s, true
			}
		}
	}
	return ChapterReviewPart{}, ChapterReviewSource{}, false
}
func ValidateChapterFactCandidates(in ChapterFactsInput, out ChapterFactsOutput) error {
	if out.Candidates == nil || len(out.Candidates) > 24 {
		return factError("validation", "candidate_count", "候选列表缺失或超过允许数量。", ErrInvalidWrite)
	}
	ids := map[string]bool{}
	for index, c := range out.Candidates {
		if c.ID == "" || len(c.ID) > 80 || ids[c.ID] || strings.TrimSpace(c.Text) == "" || utf8.RuneCountInString(c.Text) > 500 || len(c.Reason) > 2000 || !slices.Contains([]string{"event", "statement", "uncertain"}, c.Kind) {
			return factError("validation", "candidate_fields", "候选编号重复、字段缺失或内容长度不符合要求。", ErrInvalidWrite)
		}
		ids[c.ID] = true
		fact, _, factValid := factSource(in, c.Evidence)
		if !factValid {
			return factError("validation", "evidence_mismatch", fmt.Sprintf("第 %d 条候选的段落或引文与本次章稿不一致，未载入候选。", index+1), ErrInvalidWrite)
		}
		seenKnowers := map[string]bool{}
		for _, k := range c.SuggestedKnowers {
			if !slices.Contains(in.Knowledge.Characters, k.CharacterID) {
				return factError("validation", "invalid_knower", fmt.Sprintf("第 %d 条候选建议了未登记的知情角色；模型不能为未命名人物自行编造角色编号。", index+1), ErrInvalidWrite)
			}
			if seenKnowers[k.CharacterID] {
				return factError("validation", "invalid_knower", fmt.Sprintf("第 %d 条候选重复列出了同一知情角色。", index+1), ErrInvalidWrite)
			}
			p, _, valid := factSource(in, k.Evidence)
			if !valid {
				return factError("validation", "invalid_knower", fmt.Sprintf("第 %d 条候选的角色知情引文无法在所引段落逐字找到。", index+1), ErrInvalidWrite)
			}
			if p.StoryTime != fact.StoryTime {
				return factError("validation", "invalid_knower", fmt.Sprintf("第 %d 条候选的角色知情证据与事件不在同一故事时点，不能据此确认当时已知。", index+1), ErrInvalidWrite)
			}
			seenKnowers[k.CharacterID] = true
		}
		if c.RelatedFactID != "" && !slices.ContainsFunc(in.Knowledge.Facts, func(f knowledge.Fact) bool { return f.ID == c.RelatedFactID }) {
			return factError("validation", "unknown_fact_reference", fmt.Sprintf("第 %d 条候选关联了本次知识快照中不存在的事实，未载入候选。", index+1), ErrInvalidWrite)
		}
	}
	return nil
}
func BuildChapterFacts(in ChapterFactsInput, out ChapterFactsOutput, req ChapterFactsSelectionRequest) (ChapterFactPackage, string, error) {
	pack := ChapterFactPackage{BaseKnowledge: in.BaseKnowledge, Facts: []ConfirmedChapterFact{}}
	if len(req.Manual) > 8 {
		return pack, "", ErrInvalidWrite
	}
	all := ChapterFactsOutput{Candidates: append(append([]ChapterFactCandidate{}, out.Candidates...), req.Manual...)}
	if err := ValidateChapterFactCandidates(in, all); err != nil {
		return pack, "", err
	}
	candidates := map[string]ChapterFactCandidate{}
	for _, c := range all.Candidates {
		candidates[c.ID] = c
	}
	seen := map[string]bool{}
	block := ""
	for _, d := range req.Decisions {
		c, ok := candidates[d.CandidateID]
		if !ok || seen[d.CandidateID] || strings.TrimSpace(d.Reason) == "" || len(d.Reason) > 2000 {
			return pack, "", ErrInvalidWrite
		}
		seen[d.CandidateID] = true
		if d.EventBasis != "" && !slices.Contains([]string{"observed_event", "speech_act"}, d.EventBasis) {
			return pack, "", fmt.Errorf("%w: 作者事实分类无效", ErrInvalidWrite)
		}
		switch d.Action {
		case "confirm":
			if (c.Kind != "event" && d.EventBasis == "") || c.RelatedFactID != "" || strings.TrimSpace(d.Text) == "" || utf8.RuneCountInString(d.Text) > 500 {
				return pack, "", fmt.Errorf("%w: 台词或不确定内容需作者修正分类；关联旧事实不能直接作为新增事实", ErrInvalidWrite)
			}
			known := map[string]bool{}
			for _, id := range d.KnownBy {
				if known[id] || !slices.Contains(in.Knowledge.Characters, id) {
					return pack, "", ErrInvalidWrite
				}
				known[id] = true
			}
			p, s, _ := factSource(in, c.Evidence)
			pack.Facts = append(pack.Facts, ConfirmedChapterFact{ID: req.JobID + "/" + c.ID, Text: strings.TrimSpace(d.Text), ChapterID: in.ChapterID, CommitID: p.CommitID, SegmentID: s.SourceID, SourceVersion: s.SourceVersion, StoryTime: p.StoryTime, Evidence: c.Evidence, KnownBy: append([]string{}, d.KnownBy...)})
		case "exclude":
		case "keep_existing":
			if c.RelatedFactID == "" {
				return pack, "", ErrInvalidWrite
			}
		case "revise_manuscript":
			block = "仍有正文冲突待修订，请改稿并重新组稿复审"
		default:
			return pack, "", ErrInvalidWrite
		}
	}
	if len(seen) != len(candidates) {
		block = "仍有事实候选未逐条决定"
	}
	return pack, block, nil
}
