package memory

// Hit 固定检索结果及出处，作为运行输入的一部分保存；不能在恢复时重新搜索。
type Hit struct {
	Record   Record  `json:"record"`
	Digest   string  `json:"digest"`
	Origin   string  `json:"origin"` // commit / teaching_seed / knowledge
	CommitID string  `json:"commitId,omitempty"`
	Method   string  `json:"method"` // keyword / hybrid_fake / hybrid_zhipu
	Score    float64 `json:"score"`  // 排序分，不是质量门禁
}
type RetrievalContext struct {
	EmbeddingModel string `json:"embeddingModel,omitempty"`
	View           View   `json:"view"`
	Query          string `json:"query"`
	Mode           string `json:"mode"`
	Ranker         string `json:"ranker"`
	Hits           []Hit  `json:"hits"`
}
