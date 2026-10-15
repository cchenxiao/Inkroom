package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Zhipu 使用独立向量模型，不复用 DeepSeek 的 key、提示词或正文生成接口。
type Zhipu struct {
	key        string
	dimensions int
	revision   string
	client     *http.Client
	endpoint   string
}

func NewZhipu(key, revision string, dimensions int) (*Zhipu, error) {
	if strings.TrimSpace(key) == "" || revision == "" {
		return nil, fmt.Errorf("ZHIPU_API_KEY and embedding revision are required")
	}
	if dimensions != 256 && dimensions != 512 && dimensions != 1024 && dimensions != 2048 {
		return nil, fmt.Errorf("embedding-3 dimensions must be 256, 512, 1024 or 2048")
	}
	return &Zhipu{key: key, dimensions: dimensions, revision: revision, endpoint: "https://open.bigmodel.cn/api/paas/v4/embeddings", client: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (z *Zhipu) ID() string { return fmt.Sprintf("zhipu:embedding-3:%d:%s", z.dimensions, z.revision) }
func (z *Zhipu) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 || len(texts) > 32 {
		return nil, fmt.Errorf("embedding batch must contain 1–32 texts")
	}
	for _, text := range texts {
		if strings.TrimSpace(text) == "" || len(text) > 3000 {
			return nil, fmt.Errorf("embedding input must be nonempty and at most 3000 UTF-8 bytes; split long source fragments first")
		}
	}
	raw, _ := json.Marshal(struct {
		Model      string   `json:"model"`
		Input      []string `json:"input"`
		Dimensions int      `json:"dimensions"`
	}{"embedding-3", texts, z.dimensions})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, z.endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+z.key)
	resp, err := z.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Zhipu embedding request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Zhipu embedding returned HTTP %d", resp.StatusCode)
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&out); err != nil || len(out.Data) != len(texts) {
		return nil, fmt.Errorf("invalid Zhipu embedding response")
	}
	vectors := make([][]float32, len(texts))
	for _, item := range out.Data {
		if item.Index < 0 || item.Index >= len(texts) || vectors[item.Index] != nil {
			return nil, fmt.Errorf("invalid embedding response index")
		}
		if err = Validate(item.Embedding, z.dimensions); err != nil {
			return nil, err
		}
		vectors[item.Index] = item.Embedding
	}
	return vectors, nil
}
