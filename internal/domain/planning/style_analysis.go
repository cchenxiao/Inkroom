package planning

import (
	"crypto/sha256"
	"fmt"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/style"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxReferenceCharacters = 30000
const AnalysisCharacterBudget = 3000

// 起止位置均为 Unicode 字符下标，左闭右开；不是字节偏移。
type StyleExcerpt struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}
type StyleAnalysisInput struct {
	Title              string         `json:"title"`
	Text               string         `json:"text"` // 完整原文仅用于本地存档/统计，不直接送入模型。
	Digest             string         `json:"digest"`
	TotalCharacters    int            `json:"totalCharacters"`
	AnalyzedCharacters int            `json:"analyzedCharacters"`
	Samples            []StyleExcerpt `json:"samples"`
	Stats              style.Stats    `json:"stats"`
}

func NewStyleAnalysisInput(title, text string) (StyleAnalysisInput, error) {
	var in StyleAnalysisInput
	n := utf8.RuneCountInString(text)
	if !utf8.ValidString(text) || n > MaxReferenceCharacters || utf8.RuneCountInString(strings.TrimSpace(text)) < 80 || len(title) > 300 {
		return in, fmt.Errorf("参考文本需 80–30000 字，标题最多 100 字")
	}
	in = StyleAnalysisInput{Title: title, Text: text, Digest: fmt.Sprintf("%x", sha256.Sum256([]byte(text))), TotalCharacters: n, Samples: []StyleExcerpt{}, Stats: style.Analyze([]manuscript.Segment{{ID: "reference", Text: text}}, nil)[0]}
	chars := []rune(text)
	if n <= AnalysisCharacterBudget {
		in.Samples = append(in.Samples, StyleExcerpt{0, n, text})
	} else {
		width := AnalysisCharacterBudget / 3
		for _, start := range []int{0, (n - width) / 2, n - width} {
			in.Samples = append(in.Samples, StyleExcerpt{start, start + width, string(chars[start : start+width])})
		}
	}
	for _, s := range in.Samples {
		in.AnalyzedCharacters += s.End - s.Start
	}
	return in, nil
}

type StyleObservation struct {
	Dimension   string `json:"dimension"` // sentence | rhythm | dialogue | distance | imagery | humor
	SampleIndex int    `json:"sampleIndex"`
	Quote       string `json:"quote"`
	Reason      string `json:"reason"`
	Suggestion  string `json:"suggestion"`
	Certainty   string `json:"certainty"` // observed | tentative；不是量化置信度。
}
type StyleAnalysisOutput struct {
	Observations []StyleObservation `json:"observations"`
	Rules        StyleRules         `json:"rules"`
	AnchorText   string             `json:"anchorText"`
	Limitations  string             `json:"limitations"`
}

func (out StyleAnalysisOutput) Validate(in StyleAnalysisInput) error {
	if len(out.Observations) < 1 || len(out.Observations) > 6 || !bounded(out.Limitations, 1800, true) {
		return fmt.Errorf("需提供 1–6 项有依据的观察与分析限制")
	}
	dimensions := map[string]bool{"sentence": true, "rhythm": true, "dialogue": true, "distance": true, "imagery": true, "humor": true}
	seen := map[string]bool{}
	for _, o := range out.Observations {
		if !dimensions[o.Dimension] || seen[o.Dimension] || o.SampleIndex < 0 || o.SampleIndex >= len(in.Samples) || (o.Certainty != "observed" && o.Certainty != "tentative") || !bounded(o.Quote, 600, true) || !bounded(o.Reason, 1200, true) || !bounded(o.Suggestion, 1200, true) {
			return fmt.Errorf("观察维度、来源或内容无效")
		}
		if !strings.Contains(in.Samples[o.SampleIndex].Text, o.Quote) {
			return fmt.Errorf("引文不在模型可见的参考片段中")
		}
		seen[o.Dimension] = true
	}
	if !bounded(out.AnchorText, 1800, true) {
		return fmt.Errorf("建议锚文本为空或过长")
	}
	found := false
	for _, sample := range in.Samples {
		if strings.Contains(sample.Text, out.AnchorText) {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("建议锚文本必须为可见参考片段的原文摘录")
	}
	return out.Rules.Validate()
}

type StyleAnalysisRequest struct {
	RequestID string `json:"requestId"`
	Title     string `json:"title"`
	Text      string `json:"text"`
}
type StyleAnalysisJob struct {
	ID            string               `json:"id"`
	Version       int                  `json:"version"`
	Status        string               `json:"status"`
	Input         StyleAnalysisInput   `json:"input"`
	Output        *StyleAnalysisOutput `json:"output"`
	Model         string               `json:"model"`
	PromptVersion string               `json:"promptVersion"`
	SchemaVersion string               `json:"schemaVersion"`
	Calls         []model.CallRecord   `json:"calls"`
	Message       string               `json:"message"`
	CreatedAt     time.Time            `json:"createdAt"`
}
