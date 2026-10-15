// Package contracts 把响应结构和版本化 Schema 放在一起维护。
package contracts

import (
	_ "embed"

	"inkloom/internal/domain/review"
)

//go:embed writer.v1.json
var WriterSchema []byte

//go:embed critic.v1.json
var CriticSchema []byte

//go:embed polisher.v1.json
var PolisherSchema []byte

type WriterOutput struct {
	Text string `json:"text"`
}

type CriticOutput struct {
	Findings []review.Finding `json:"findings"`
}

//go:embed hard_consistency.v1.json
var ConsistencySchema []byte

//go:embed reviser.v1.json
var ReviserSchema []byte
