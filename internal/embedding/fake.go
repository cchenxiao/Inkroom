// Package embedding 提供向量模型适配器，独立于生成正文的 ChatModel。
package embedding

import (
	"context"
	"hash/fnv"
	"strings"
	"unicode"
)

// Fake 为流程测试提供确定性的字词哈希向量，没有语义理解能力。
type Fake struct{}

func (Fake) ID() string { return "fake-hash-v1" }
func (Fake) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, 0, len(texts))
	for _, text := range texts {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		v := make([]float32, 64)
		runes := []rune(strings.ToLower(text))
		for i, r := range runes {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
				continue
			}
			term := string(r)
			if i+1 < len(runes) && (unicode.IsLetter(runes[i+1]) || unicode.IsDigit(runes[i+1])) {
				term = string(runes[i : i+2])
			}
			h := fnv.New32a()
			_, _ = h.Write([]byte(term))
			v[h.Sum32()%64]++
		}
		if err := Validate(v, 64); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}
