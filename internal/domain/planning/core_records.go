package planning

import (
	"fmt"
	"inkloom/internal/agents/model"
	"time"
)

type CoreStartRequest struct {
	RequestID                string `json:"requestId"`
	ExpectedInputVersion     int    `json:"expectedInputVersion"`
	ExpectedDirectionVersion int    `json:"expectedDirectionVersion"`
	ExpectedStyleVersion     int    `json:"expectedStyleVersion"`
	Request                  string `json:"request"`
}
type CoreJob struct {
	ID            string              `json:"id"`
	Version       int                 `json:"version"`
	Status        string              `json:"status"`
	Request       CoreStartRequest    `json:"request"`
	Input         CoreSettingsInput   `json:"input"`
	Output        *CoreSettingsOutput `json:"output"`
	Model         string              `json:"model"`
	PromptVersion string              `json:"promptVersion"`
	SchemaVersion string              `json:"schemaVersion"`
	Calls         []model.CallRecord  `json:"calls"`
	Message       string              `json:"message"`
	CreatedAt     time.Time           `json:"createdAt"`
}

// Decisions 属于作者操作；不出现在模型输出契约中。
type CoreDecision string

const (
	CorePending   CoreDecision = "pending"
	CoreConfirmed CoreDecision = "confirmed"
	CoreRejected  CoreDecision = "rejected"
)

type CoreSaveRequest struct {
	ExpectedInputVersion     int                     `json:"expectedInputVersion"`
	ExpectedDirectionVersion int                     `json:"expectedDirectionVersion"`
	ExpectedStyleVersion     int                     `json:"expectedStyleVersion"`
	ExpectedCoreVersion      int                     `json:"expectedCoreVersion"`
	SourceCoreVersion        int                     `json:"sourceCoreVersion"`
	JobID                    string                  `json:"jobId"`
	CandidateVersion         int                     `json:"candidateVersion"`
	Content                  CoreSettingsOutput      `json:"content"`
	Decisions                map[string]CoreDecision `json:"decisions"`
}
type CoreSelection struct {
	Version           int                     `json:"version"`
	InputVersion      int                     `json:"inputVersion"`
	DirectionVersion  int                     `json:"directionVersion"`
	StyleVersion      int                     `json:"styleVersion"`
	SourceCoreVersion int                     `json:"sourceCoreVersion"`
	JobID             string                  `json:"jobId"`
	CandidateVersion  int                     `json:"candidateVersion"`
	Content           CoreSettingsOutput      `json:"content"`
	Decisions         map[string]CoreDecision `json:"decisions"`
	CreatedAt         time.Time               `json:"createdAt"`
}

func (r CoreSaveRequest) Validate() error {
	if !bounded(r.JobID, 80, true) || r.CandidateVersion < 1 || r.SourceCoreVersion < 0 {
		return fmt.Errorf("候选来源不完整")
	}
	if err := r.Content.Validate(); err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, c := range r.Content.Characters {
		ids[c.ID] = true
	}
	for _, f := range r.Content.WorldFacts {
		ids[f.ID] = true
	}
	for _, p := range r.Content.Plans {
		ids[p.ID] = true
	}
	if len(ids) != len(r.Decisions) {
		return fmt.Errorf("每项都须有明确的待确认、确认或舍弃状态")
	}
	for id := range ids {
		d := r.Decisions[id]
		if d != CorePending && d != CoreConfirmed && d != CoreRejected {
			return fmt.Errorf("条目状态无效")
		}
	}
	confirmed := func(id string) bool { return id == "world" || r.Decisions[id] == CoreConfirmed }
	for _, c := range r.Content.Characters {
		if confirmed(c.ID) {
			for _, ref := range c.HardFactIDs {
				if !confirmed(ref) {
					return fmt.Errorf("确认人物前，请同时确认其硬特质事实")
				}
			}
		}
	}
	for _, f := range r.Content.WorldFacts {
		if confirmed(f.ID) {
			if !confirmed(f.Subject) {
				return fmt.Errorf("确认事实前，请确认其所属人物")
			}
			for _, k := range f.KnownBy {
				if !confirmed(k.CharacterID) {
					return fmt.Errorf("事实的知情人物仍未确认")
				}
			}
		}
	}
	for _, p := range r.Content.Plans {
		if confirmed(p.ID) && !confirmed(p.Subject) {
			return fmt.Errorf("确认计划前，请确认其所属人物")
		}
	}
	return nil
}
