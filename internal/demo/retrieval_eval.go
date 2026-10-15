package demo

type RetrievalCase struct {
	Query      string `json:"query"`
	ExpectedID string `json:"expectedId"`
}

// 小型教学评测只验证能否找回埋点，不能代表真实小说检索质量。
var RetrievalCases = []RetrievalCase{
	{Query: "父亲衣物上缺少的纽子", ExpectedID: "seed-copper"},
	{Query: "她是否声称自己没见过那封信", ExpectedID: "seed-dialogue"},
	{Query: "闸门的锁是否还完好", ExpectedID: "seed-outdated"},
}
