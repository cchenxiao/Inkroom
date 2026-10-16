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

//go:embed tone_director.v1.json
var ToneDirectionSchema []byte

//go:embed trial_writer.v1.json
var TrialWriterSchema []byte

//go:embed style_analyst.v1.json
var StyleAnalystSchema []byte

//go:embed core_planner.v1.json
var CorePlannerSchema []byte

//go:embed story_architect.v1.json
var StoryArchitectSchema []byte

//go:embed showrunner.v1.json
var ShowrunnerSchema []byte

//go:embed chapter_review.v1.json
var ChapterReviewSchema []byte
