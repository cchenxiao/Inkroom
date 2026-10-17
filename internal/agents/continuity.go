package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"strings"
	"sync"
	"unicode"
)

type narrativeLine struct {
	ID        string `json:"id"`
	SegmentID string `json:"segmentId"`
	Text      string `json:"text"`
	Writable  bool   `json:"writable"`
	Source    string `json:"-"`
}
type continuityIssue struct {
	Earlier     string `json:"earlier"`
	Later       string `json:"later"`
	Reason      string `json:"reason"`
	Suggestion  string `json:"suggestion"`
	NeedsAuthor bool   `json:"needsAuthor"`
}
type continuityPairs struct {
	Checked []string          `json:"checked"`
	Issues  []continuityIssue `json:"issues"`
}

const pairsSchema = `{"type":"object","additionalProperties":false,"required":["checked","issues"],"properties":{"checked":{"type":"array","items":{"type":"string"}},"issues":{"type":"array","maxItems":12,"items":{"type":"object","additionalProperties":false,"required":["earlier","later","reason","suggestion","needsAuthor"],"properties":{"earlier":{"type":"string"},"later":{"type":"string"},"reason":{"type":"string","minLength":1,"maxLength":600},"suggestion":{"type":"string","minLength":1,"maxLength":600},"needsAuthor":{"type":"boolean"}}}}}}`

// CheckNarrativeContinuity is also used by the isolated narrative acceptance suite.
func CheckNarrativeContinuity(ctx context.Context, chat model.ChatModel, ss []manuscript.Segment, version int, b manuscript.ContextBundle) (out ConsistencyAssessment, usage model.Usage, err error) {
	// Split the question, not the manuscript: both passes see every intervening
	// action and preserve the original writable boundary.
	size := 0
	count := func(text string) {
		for _, r := range text {
			if !unicode.IsSpace(r) {
				size++
			}
		}
	}
	for _, s := range ss {
		count(s.Text)
	}
	for _, n := range b.Neighbors {
		for _, s := range n.Segments {
			count(s.Text)
		}
	}
	if size <= 3000 {
		return checkContinuityPairs(ctx, chat, ss, version, b)
	}

	// Independent questions share the same immutable source and run budget.
	// Merge in focus order, regardless of completion order; never expose half a check.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	focuses := []string{"objects", "characters"}
	parts := make([]ConsistencyAssessment, len(focuses))
	usages := make([]model.Usage, len(focuses))
	errs := make([]error, len(focuses))
	var wg sync.WaitGroup
	for i, focus := range focuses {
		wg.Add(1)
		go func(i int, focus string) {
			defer wg.Done()
			parts[i], usages[i], errs[i] = checkContinuityFocus(ctx, chat, ss, version, b, focus)
			if errs[i] != nil {
				cancel()
			}
		}(i, focus)
	}
	wg.Wait()
	usage.Known = true
	for _, u := range usages {
		usage.InputTokens += u.InputTokens
		usage.OutputTokens += u.OutputTokens
		usage.Known = usage.Known && u.Known
	}
	if err := errors.Join(errs...); err != nil {
		return ConsistencyAssessment{}, usage, err
	}
	seen := map[string]bool{}
	for _, part := range parts {
		for _, f := range part.Findings {
			key := f.SegmentID + "\x00" + f.Quote + "\x00" + f.RuleRef + "\x00" + f.RuleQuote
			if seen[key] {
				continue
			}
			seen[key] = true
			f.ID = fmt.Sprintf("continuity-pair-%d", len(out.Findings)+1)
			out.Findings = append(out.Findings, f)
		}
		if out.Continuity == nil {
			out.Continuity = part.Continuity
		} else {
			for i, c := range part.Continuity {
				if c.Status != "clear" {
					out.Continuity[i] = c
				}
			}
		}
	}
	_, err = review.Aggregate(out.Findings, ss, version, b.ReadingSources()...)
	return out, usage, err
}

// An independent, bounded reading pass after fact/author verification. Models
// select immutable paragraph IDs; source quotes are restored by the program.
func checkContinuityPairs(ctx context.Context, chat model.ChatModel, ss []manuscript.Segment, version int, b manuscript.ContextBundle) (out ConsistencyAssessment, usage model.Usage, err error) {
	return checkContinuityFocus(ctx, chat, ss, version, b, "all")
}

func checkContinuityFocus(ctx context.Context, chat model.ChatModel, ss []manuscript.Segment, version int, b manuscript.ContextBundle, focus string) (out ConsistencyAssessment, usage model.Usage, err error) {
	lines := []narrativeLine{}
	targets := []string{}
	appendSegment := func(s manuscript.Segment, writable bool, source string) {
		for _, p := range strings.Split(s.Text, "\n") {
			if strings.TrimSpace(p) == "" {
				continue
			}
			lines = append(lines, narrativeLine{ID: fmt.Sprintf("p%d", len(lines)+1), SegmentID: s.ID, Text: p, Writable: writable, Source: source})
		}
	}
	for _, n := range b.Neighbors {
		if n.Position == "before" {
			for _, s := range n.Segments {
				appendSegment(s, false, "passage/"+n.BeatID+"/"+s.ID)
			}
		}
	}
	for _, s := range ss {
		targets = append(targets, s.ID)
		appendSegment(s, true, s.ID)
	}
	for _, n := range b.Neighbors {
		if n.Position == "after" {
			for _, s := range n.Segments {
				appendSegment(s, false, "passage/"+n.BeatID+"/"+s.ID)
			}
		}
	}
	byID := map[string]narrativeLine{}
	order := map[string]int{}
	for i, p := range lines {
		byID[p.ID] = p
		order[p.ID] = i
	}
	material, err := json.Marshal(struct {
		Pass    bool            `json:"continuityPass"`
		Focus   string          `json:"focus"`
		Targets []string        `json:"targets"`
		Lines   []narrativeLine `json:"lines"`
	}{true, focus, targets, lines})
	if err != nil {
		return out, usage, err
	}
	result, usage, err := parse.Generate[continuityPairs](ctx, chat, model.Input{Role: "hard_consistency", Task: "按叙事顺序冷读所有原文段落，找出人物与物件状态的矛盾；只用给出的段落编号定位证据。", Material: material, OutputSchema: []byte(pairsSchema)}, func(r continuityPairs) error {
		if len(r.Checked) != len(targets) {
			return fmt.Errorf("incomplete continuity coverage")
		}
		for i, t := range targets {
			if r.Checked[i] != t {
				return fmt.Errorf("incorrect continuity target order")
			}
		}
		seen := map[string]bool{}
		for _, x := range r.Issues {
			a, aok := byID[x.Earlier]
			z, zok := byID[x.Later]
			if !aok || !zok || order[x.Earlier] > order[x.Later] {
				return fmt.Errorf("invalid narrative evidence IDs or order")
			}
			if !a.Writable && !z.Writable {
				return fmt.Errorf("continuity issue must target writable evidence")
			}
			key := x.Earlier + "/" + x.Later
			if seen[key] {
				return fmt.Errorf("duplicate continuity issue")
			}
			seen[key] = true
		}
		return nil
	})
	if err != nil {
		return out, usage, fmt.Errorf("continuity check: %w", err)
	}
	out.Findings = []review.Finding{}
	for i, x := range result.Issues {
		a, z := byID[x.Earlier], byID[x.Later]
		quote, rule := z, a
		if !z.Writable {
			quote, rule = a, z
		}
		out.Findings = append(out.Findings, review.Finding{ID: fmt.Sprintf("continuity-pair-%d", i+1), Critic: "hard_consistency", Severity: review.P1, SegmentID: quote.SegmentID, Quote: quote.Text, RuleRef: rule.Source, RuleQuote: rule.Text, EvidenceRefs: []string{quote.SegmentID, rule.Source}, Reason: x.Reason, Suggestion: x.Suggestion, RepairScope: "segment", DraftVersion: version, EvidenceStatus: "confirmed", RequiresHuman: true})
	}
	for _, s := range ss {
		c := review.ContinuityCheck{SegmentID: s.ID, Status: "clear", Reason: "本轮逐段对照暂未发现有证据的状态冲突；仍需作者核对。"}
		for _, p := range lines {
			if p.Writable && p.SegmentID == s.ID {
				if c.OpeningQuote == "" {
					c.OpeningQuote = p.Text
				}
				c.ClosingQuote = p.Text
			}
		}
		for _, f := range out.Findings {
			if f.SegmentID == s.ID {
				c.Status = "conflict"
				c.Reason = f.Reason
				c.OpeningQuote = f.RuleQuote
				c.ClosingQuote = f.Quote
				break
			}
		}
		out.Continuity = append(out.Continuity, c)
	}
	_, err = review.Aggregate(out.Findings, ss, version, b.ReadingSources()...)
	return out, usage, err
}
