package agents

import (
	"context"
	"encoding/json"
	"fmt"

	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"strings"
)

// CheckConsistency 不接收大纲/风格或其他评审结果，只给本章可见的事实和正文快照。
func CheckConsistency(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle) ([]review.Finding, model.Usage, error) {
	fs, _, usage, err := CheckConsistencyRevision(ctx, chat, segments, version, bundle, nil)
	return fs, usage, err
}

// CheckConsistencyRevision checks the author's request independently of the writer.
type ConsistencyAssessment struct {
	Findings    []review.Finding         `json:"findings"`
	AuthorCheck *review.AuthorCheck      `json:"authorCheck,omitempty"`
	Continuity  []review.ContinuityCheck `json:"continuity,omitempty"`
}

func CheckConsistencyRevision(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle, request *manuscript.AuthorRewrite) ([]review.Finding, *review.AuthorCheck, model.Usage, error) {
	result, usage, err := AssessConsistency(ctx, chat, segments, version, bundle, request)
	return result.Findings, result.AuthorCheck, usage, err
}
func AssessConsistency(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle, request *manuscript.AuthorRewrite) (ConsistencyAssessment, model.Usage, error) {
	result, usage, err := assessFacts(ctx, chat, segments, version, bundle, request)
	if err != nil || bundle.WritingTask == nil || !bundle.WritingTask.ExperimentalContinuity {
		return result, usage, err
	}
	extra, u, err := CheckNarrativeContinuity(ctx, chat, segments, version, bundle)
	usage.InputTokens += u.InputTokens
	usage.OutputTokens += u.OutputTokens
	usage.Known = usage.Known && u.Known
	if err != nil {
		return result, usage, err
	}
	result.Continuity = extra.Continuity
	for _, f := range extra.Findings {
		result.Findings = append(result.Findings, f)
	}
	_, err = review.Aggregate(result.Findings, segments, version, bundle.ReadingSources()...)
	return result, usage, err
}
func assessFacts(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle, request *manuscript.AuthorRewrite) (ConsistencyAssessment, model.Usage, error) {
	type targetFacts struct {
		BeatID     string                      `json:"beatId"`
		POV        string                      `json:"pov"`
		Characters []manuscript.CharacterFacts `json:"characters"`
		Facts      []manuscript.SourceRef      `json:"facts"`
	}
	targets := []targetFacts{}
	for _, target := range bundle.Targets {
		targets = append(targets, targetFacts{target.Beat.ID, target.POV, target.Characters, target.ExplicitFacts()})
	}
	material, err := json.Marshal(struct {
		AuthorRequest *manuscript.AuthorRewrite   `json:"authorRequest,omitempty"`
		DraftVersion  int                         `json:"draftVersion"`
		Segments      []manuscript.Segment        `json:"segments"`
		Characters    []manuscript.CharacterFacts `json:"characters"`
		Facts         []manuscript.SourceRef      `json:"facts"`
		Neighbors     []manuscript.Passage        `json:"neighbors,omitempty"`
		Targets       []targetFacts               `json:"targets,omitempty"`
	}{request, version, segments, bundle.Characters, bundle.ExplicitFacts(), bundle.Neighbors, targets})
	if err != nil {
		return ConsistencyAssessment{}, model.Usage{}, err
	}
	schema := contracts.ConsistencySchema
	if request != nil {
		var object map[string]any
		if err := json.Unmarshal(schema, &object); err != nil {
			return ConsistencyAssessment{}, model.Usage{}, err
		}
		if request != nil {
			object["properties"].(map[string]any)["authorCheck"] = map[string]any{
				"type": "object", "additionalProperties": false,
				"properties": map[string]any{
					"status": map[string]any{"type": "string", "enum": []string{"addressed", "unresolved", "needs_clarification"}},
					"reason": map[string]any{"type": "string", "minLength": 1, "maxLength": 1000},
					"quote":  map[string]any{"type": "string", "minLength": 1, "maxLength": 20000},
				}, "required": []string{"status", "reason", "quote"},
			}
			object["required"] = append(object["required"].([]any), "authorCheck")
		}
		schema, err = json.Marshal(object)
		if err != nil {
			return ConsistencyAssessment{}, model.Usage{}, err
		}
	}
	type output = ConsistencyAssessment
	task := "核对本轮正文与明确事实；证据不足不判硬伤；需要事实裁决或越界修改时标记交人。"
	result, usage, err := parse.Generate[output](ctx, chat, model.Input{Role: "hard_consistency", Task: task, Material: material, OutputSchema: schema}, func(out output) error {
		bindReviewVersion(out.Findings, version)
		normalizeNeighborRefs(out.Findings, segments, bundle.Neighbors)
		if request != nil {
			if out.AuthorCheck == nil || strings.TrimSpace(out.AuthorCheck.Reason) == "" || strings.TrimSpace(out.AuthorCheck.Quote) == "" {
				return fmt.Errorf("missing author request assessment")
			}
			found := false
			for _, segment := range segments {
				if segment.ID == request.SegmentID && strings.Contains(segment.Text, out.AuthorCheck.Quote) {
					found = true
					if segment.Text == request.Original && out.AuthorCheck.Status == "addressed" {
						return fmt.Errorf("unchanged text cannot satisfy a rewrite request")
					}
				}
			}
			if !found {
				return fmt.Errorf("author assessment quote must exist in target")
			}
		}
		for _, f := range out.Findings {
			for _, segment := range segments {
				if segment.ID == f.SegmentID && len(bundle.Targets) > 0 {
					target, ok := bundle.ForBeat(segment.BeatID)
					if !ok {
						return fmt.Errorf("unknown target")
					}
					if _, err := review.Aggregate([]review.Finding{f}, segments, version, target.ReadingSources()...); err != nil {
						return err
					}
				}
			}
		}
		_, err := review.Aggregate(out.Findings, segments, version, bundle.ReadingSources()...)
		return err
	})
	if err != nil {
		return ConsistencyAssessment{}, usage, fmt.Errorf("consistency critic: %w", err)
	}
	if request != nil && result.AuthorCheck.Status != "addressed" {
		result.Findings = append(result.Findings, review.Finding{
			ID: "author-request-review", Critic: "hard_consistency", Severity: review.P3,
			SegmentID: request.SegmentID, Quote: result.AuthorCheck.Quote, RuleRef: request.SegmentID,
			RuleQuote: result.AuthorCheck.Quote, EvidenceRefs: []string{request.SegmentID},
			Reason: result.AuthorCheck.Reason, Suggestion: "请核对作者修改要求，修改正文或明确需要调整的范围后重新复检。",
			RepairScope: "segment", DraftVersion: version, EvidenceStatus: "uncertain", RequiresHuman: true,
		})
	}
	return result, usage, nil
}
